import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findMatches } from './matcher.js';

const DEFAULT_PORT = Number(process.env.PORT || 3000);
const DEFAULT_SCAN_INTERVAL_MS = Math.max(60_000, Number(process.env.SCAN_INTERVAL_MS || 300_000));
const PUBLIC_DIR = join(process.cwd(), 'public');
const POLYMARKET_API = process.env.POLYMARKET_API || 'https://gateway.polymarket.us';
const KALSHI_API = process.env.KALSHI_API || 'https://external-api.kalshi.com/trade-api/v2';
const POLY_PAGE_LIMIT = 100;
const KALSHI_PAGE_LIMIT = 1000;
const MAX_PAGES = 100;

const nowIso = () => new Date().toISOString();
const rootType = (value) => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
const topLevelKeys = (value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function emptyVenueDiagnostics(baseUrl) {
  return {
    baseUrl,
    exactLastRequestUrl: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    httpStatus: null,
    finalUrl: null,
    contentType: null,
    responseRootType: null,
    topLevelKeys: [],
    firstPageRawCount: null,
    normalizedCount: 0,
    pagination: null,
    retryCount: 0,
    error: null,
    sample: null,
  };
}

function serializeError(error, seen = new Set()) {
  if (!error) return null;
  if (typeof error !== 'object') return { message: String(error) };
  if (seen.has(error)) return { message: '[circular error]' };
  seen.add(error);
  const output = {
    name: error.name || 'Error',
    message: error.message || String(error),
    code: error.code || undefined,
    stack: error.stack || undefined,
  };
  if (error.cause) output.cause = serializeError(error.cause, seen);
  if (Array.isArray(error.errors)) output.errors = error.errors.map((item) => serializeError(item, seen));
  return output;
}

function redactSample(value) {
  if (!value || typeof value !== 'object') return value ?? null;
  const clone = structuredClone(value);
  const redact = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (/token|secret|password|authorization|api[_-]?key/i.test(key)) node[key] = '[redacted]';
      else redact(node[key]);
    }
  };
  redact(clone);
  return clone;
}

function initialSnapshot() {
  return {
    links: [],
    counts: { polymarket: 0, kalshi: 0, candidates: 0 },
    updatedAt: null,
    scanning: false,
    errors: [],
    sources: { polymarket: { state: 'waiting' }, kalshi: { state: 'waiting' } },
  };
}

let scanInProgress = null;
let snapshot = initialSnapshot();
let catalogs = { polymarket: [], kalshi: [] };
let retrievalDiagnostics = {
  polymarket: emptyVenueDiagnostics(POLYMARKET_API),
  kalshi: emptyVenueDiagnostics(KALSHI_API),
};

export function resetRuntimeForTests() {
  scanInProgress = null;
  snapshot = initialSnapshot();
  catalogs = { polymarket: [], kalshi: [] };
  retrievalDiagnostics = {
    polymarket: emptyVenueDiagnostics(POLYMARKET_API),
    kalshi: emptyVenueDiagnostics(KALSHI_API),
  };
}

export function getRuntimeSnapshot() {
  return structuredClone(snapshot);
}

export function getRetrievalDiagnostics() {
  return structuredClone(retrievalDiagnostics);
}

async function getJson(url, venue, { retries = 4 } = {}) {
  const diagnostic = retrievalDiagnostics[venue];
  diagnostic.exactLastRequestUrl = url;
  diagnostic.lastAttemptAt = nowIso();
  diagnostic.error = null;
  for (let attempt = 0; ; attempt += 1) {
    diagnostic.retryCount = attempt;
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Crossmark/2.1 (+read-only market research)' },
        signal: AbortSignal.timeout(30_000),
      });
      diagnostic.httpStatus = response.status;
      diagnostic.finalUrl = response.url || url;
      diagnostic.contentType = response.headers.get('content-type');
      const bodyText = await response.text();
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * (2 ** attempt));
          continue;
        }
        throw new Error(`${venue} HTTP ${response.status} ${response.statusText} for ${url}${bodyText ? ` — ${bodyText.slice(0, 1000)}` : ''}`);
      }
      let payload;
      try {
        payload = JSON.parse(bodyText);
      } catch (error) {
        throw new Error(`${venue} returned invalid JSON for ${url}: ${error.message}; body=${bodyText.slice(0, 1000)}`, { cause: error });
      }
      diagnostic.responseRootType = rootType(payload);
      diagnostic.topLevelKeys = topLevelKeys(payload);
      return payload;
    } catch (error) {
      if (attempt < retries && (error?.name === 'TimeoutError' || error?.cause || error?.code)) {
        await sleep(500 * (2 ** attempt));
        continue;
      }
      const wrapped = new Error(`${venue} retrieval failed for ${url}: ${error.message}`, { cause: error });
      diagnostic.error = serializeError(wrapped);
      throw wrapped;
    }
  }
}

async function reviewWithAi(links) {
  if (!process.env.OPENAI_API_KEY || !links.length) return links;
  const reviewable = links.slice(0, 30);
  const input = reviewable.map((link, index) => ({
    index,
    polymarket: { title: link.polymarket.title, rules: link.polymarket.description },
    kalshi: { title: link.kalshi.title, rules: link.kalshi.description },
  }));
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      instructions: 'Conservatively decide whether each pair is the same binary proposition. Dates, thresholds, subjects, outcome direction, and resolution conditions must agree. Return JSON only: {"reviews":[{"index":0,"equivalent":true,"reason":"short reason"}]}.',
      input: JSON.stringify(input),
      text: { format: { type: 'json_object' } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  const outputText = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
  const reviews = JSON.parse(outputText).reviews || [];
  const byIndex = new Map(reviews.map((review) => [review.index, review]));
  return links.filter((link, index) => {
    if (index >= reviewable.length) return true;
    const review = byIndex.get(index);
    if (!review?.equivalent) return false;
    link.aiReviewed = true;
    link.explanation = `AI review: ${review.reason}`;
    return true;
  });
}

const amount = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

function mapPolymarket(market) {
  return {
    id: String(market.conditionId || market.id),
    title: market.question || market.title,
    description: market.description || '',
    category: market.category || '',
    closeTime: market.endDate || null,
    volume: amount(market.volume24hr, market.volumeNum, market.volume),
    price: amount(market.lastTradePrice, market.marketSides?.find((side) => side.long)?.price),
    url: market.url || market.webUrl || 'https://polymarket.us',
  };
}

function mapKalshi(market) {
  return {
    id: market.ticker,
    title: market.title,
    description: [market.subtitle, market.yes_sub_title].filter(Boolean).join(' — '),
    category: market.category || '',
    closeTime: market.close_time || market.expiration_time || null,
    volume: amount(market.volume_24h_fp, market.volume_24h, market.volume_fp, market.volume),
    price: amount(market.last_price_dollars, market.yes_bid_dollars),
    url: `https://kalshi.com/markets/${encodeURIComponent(market.event_ticker || market.ticker)}`,
  };
}

function schemaError(venue, url, message) {
  const error = new Error(`${venue} schema error for ${url}: ${message}`);
  retrievalDiagnostics[venue].error = serializeError(error);
  return error;
}

async function fetchPolymarket() {
  const markets = [];
  let pages = 0;
  for (let offset = 0, pageNumber = 0; pageNumber < MAX_PAGES; offset += POLY_PAGE_LIMIT, pageNumber += 1) {
    const url = `${POLYMARKET_API}/v1/markets?active=true&closed=false&limit=${POLY_PAGE_LIMIT}&offset=${offset}`;
    const payload = await getJson(url, 'polymarket');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.markets)) {
      throw schemaError('polymarket', url, `expected object with markets array; got ${rootType(payload)} keys=${topLevelKeys(payload).join(',')}`);
    }
    const page = payload.markets;
    if (pageNumber === 0) {
      retrievalDiagnostics.polymarket.firstPageRawCount = page.length;
      retrievalDiagnostics.polymarket.sample = redactSample(page[0] || null);
    }
    markets.push(...page);
    pages += 1;
    retrievalDiagnostics.polymarket.pagination = { pages, offset, pageSize: POLY_PAGE_LIMIT, hasMore: page.length === POLY_PAGE_LIMIT };
    if (page.length < POLY_PAGE_LIMIT) break;
    await sleep(75);
  }
  const normalized = [...new Map(markets.map((market) => [market.conditionId || market.id, market])).values()].map(mapPolymarket);
  retrievalDiagnostics.polymarket.normalizedCount = normalized.length;
  retrievalDiagnostics.polymarket.lastSuccessAt = nowIso();
  retrievalDiagnostics.polymarket.error = null;
  return normalized;
}

async function fetchKalshi() {
  const markets = [];
  let cursor = '';
  let pageNumber = 0;
  do {
    const query = new URLSearchParams({ status: 'open', limit: String(KALSHI_PAGE_LIMIT), mve_filter: 'exclude' });
    if (cursor) query.set('cursor', cursor);
    const url = `${KALSHI_API}/markets?${query}`;
    const payload = await getJson(url, 'kalshi');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.markets)) {
      throw schemaError('kalshi', url, `expected object with markets array; got ${rootType(payload)} keys=${topLevelKeys(payload).join(',')}`);
    }
    if (payload.cursor != null && typeof payload.cursor !== 'string') {
      throw schemaError('kalshi', url, `expected cursor to be string/null; got ${typeof payload.cursor}`);
    }
    if (pageNumber === 0) {
      retrievalDiagnostics.kalshi.firstPageRawCount = payload.markets.length;
      retrievalDiagnostics.kalshi.sample = redactSample(payload.markets[0] || null);
    }
    markets.push(...payload.markets);
    cursor = payload.cursor || '';
    pageNumber += 1;
    retrievalDiagnostics.kalshi.pagination = { pages: pageNumber, cursorPresent: Boolean(cursor), pageSize: KALSHI_PAGE_LIMIT };
    if (cursor) await sleep(150);
  } while (cursor && pageNumber < MAX_PAGES);
  const normalized = [...new Map(markets.map((market) => [market.ticker, market])).values()].map(mapKalshi);
  retrievalDiagnostics.kalshi.normalizedCount = normalized.length;
  retrievalDiagnostics.kalshi.lastSuccessAt = nowIso();
  retrievalDiagnostics.kalshi.error = null;
  return normalized;
}

export async function scanMarkets() {
  if (scanInProgress) return scanInProgress;
  snapshot = {
    ...snapshot,
    scanning: true,
    errors: [],
    sources: { polymarket: { state: 'syncing' }, kalshi: { state: 'syncing' } },
  };
  scanInProgress = (async () => {
    const [polyResult, kalshiResult] = await Promise.allSettled([fetchPolymarket(), fetchKalshi()]);
    const errors = [];
    if (polyResult.status === 'fulfilled') catalogs.polymarket = polyResult.value;
    else errors.push(`Polymarket: ${polyResult.reason.message}`);
    if (kalshiResult.status === 'fulfilled') catalogs.kalshi = kalshiResult.value;
    else errors.push(`Kalshi: ${kalshiResult.reason.message}`);

    const matched = findMatches(catalogs.polymarket, catalogs.kalshi);
    let links = matched.links;
    if (process.env.OPENAI_API_KEY) {
      try { links = await reviewWithAi(links); } catch (error) { errors.push(error.message); }
    }
    snapshot = {
      links,
      counts: {
        polymarket: catalogs.polymarket.length,
        kalshi: catalogs.kalshi.length,
        candidates: matched.candidateCount,
      },
      updatedAt: nowIso(),
      scanning: false,
      errors,
      sources: {
        polymarket: {
          state: polyResult.status === 'fulfilled' ? 'online' : catalogs.polymarket.length ? 'degraded' : 'error',
          markets: catalogs.polymarket.length,
          endpoint: retrievalDiagnostics.polymarket.exactLastRequestUrl,
        },
        kalshi: {
          state: kalshiResult.status === 'fulfilled' ? 'online' : catalogs.kalshi.length ? 'degraded' : 'error',
          markets: catalogs.kalshi.length,
          endpoint: retrievalDiagnostics.kalshi.exactLastRequestUrl,
        },
      },
    };
    return snapshot;
  })().finally(() => { scanInProgress = null; });
  return scanInProgress;
}

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

export function createAppServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/health' && request.method === 'GET') {
        return sendJson(response, 200, { ok: true, scanning: snapshot.scanning, updatedAt: snapshot.updatedAt });
      }
      if (url.pathname === '/api/retrieval-diagnostics' && request.method === 'GET') {
        return sendJson(response, 200, { counts: snapshot.counts, venues: retrievalDiagnostics });
      }
      if (url.pathname === '/api/links' && request.method === 'GET') return sendJson(response, 200, snapshot);
      if (url.pathname === '/api/scan' && request.method === 'POST') {
        scanMarkets().catch(console.error);
        return sendJson(response, 202, { started: true });
      }
      const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const publicRoot = resolve(PUBLIC_DIR);
      const filePath = resolve(PUBLIC_DIR, requested);
      if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) throw new Error('Invalid path');
      const body = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': `${MIME[extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
      response.end(body);
    } catch (error) {
      if (request.url?.startsWith('/api/') || request.url === '/health') {
        return sendJson(response, 500, { error: error.message });
      }
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
}

export function startServer({ port = DEFAULT_PORT, scanOnStart = true, scanIntervalMs = DEFAULT_SCAN_INTERVAL_MS } = {}) {
  const server = createAppServer();
  let timer = null;
  server.listen(port, '0.0.0.0', () => {
    const address = server.address();
    console.log(`Crossmark is running on port ${typeof address === 'object' && address ? address.port : port}`);
    if (scanOnStart) setImmediate(() => scanMarkets().catch(console.error));
    if (scanIntervalMs > 0) timer = setInterval(() => scanMarkets().catch(console.error), scanIntervalMs);
    timer?.unref();
  });
  server.on('close', () => { if (timer) clearInterval(timer); });
  return server;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) startServer();
