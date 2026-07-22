import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';

const PORT = Number(process.env.PORT || 3000);
const SCAN_INTERVAL_MS = Math.max(60_000, Number(process.env.SCAN_INTERVAL_MS || 300_000));
const PUBLIC_DIR = join(process.cwd(), 'public');
const POLYMARKET_API = process.env.POLYMARKET_API || 'https://gateway.polymarket.us';
const KALSHI_API = process.env.KALSHI_API || 'https://external-api.kalshi.com/trade-api/v2';
const POLY_PAGE_LIMIT = 100;
const KALSHI_PAGE_LIMIT = 1000;
const MAX_PAGES = 100;
const MATCH_TIMEOUT_MS = Math.max(15_000, Number(process.env.MATCH_TIMEOUT_MS || 120_000));
let scanInProgress = null;
let snapshot = {
  links: [], counts: { polymarket: 0, kalshi: 0, candidates: 0 }, updatedAt: null,
  scanning: false, errors: [], sources: { polymarket: { state: 'waiting' }, kalshi: { state: 'waiting' } },
};

async function reviewWithAi(links) {
  if (!process.env.OPENAI_API_KEY || !links.length) return links;
  const reviewable = links.slice(0, 30);
  const input = reviewable.map((link, index) => ({
    index, polymarket: { title: link.polymarket.title, rules: link.polymarket.description },
    kalshi: { title: link.kalshi.title, rules: link.kalshi.description },
  }));
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      instructions: 'Conservatively decide whether each pair is the same binary proposition. Dates, thresholds, subjects, outcome direction, and resolution conditions must agree. Return JSON only: {"reviews":[{"index":0,"equivalent":true,"reason":"short reason"}]}.',
      input: JSON.stringify(input), text: { format: { type: 'json_object' } },
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

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getJson(url, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'MarketLinker/2.0 (+read-only market research)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * (2 ** attempt));
      continue;
    }
    const detail = (await response.text()).slice(0, 160).trim();
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
  }
}

const amount = (...values) => {
  for (const value of values) { const parsed = Number(value); if (Number.isFinite(parsed)) return parsed; }
  return 0;
};

function mapPolymarket(market) {
  return {
    id: String(market.conditionId || market.id), title: market.question || market.title,
    description: market.description || '', category: market.category || '',
    closeTime: market.endDate || null, volume: amount(market.volume24hr, market.volumeNum, market.volume),
    price: amount(market.lastTradePrice, market.marketSides?.find((side) => side.long)?.price),
    url: market.slug ? `https://polymarket.us/market/${market.slug}` : 'https://polymarket.us',
  };
}

function mapKalshi(market) {
  return {
    id: market.ticker, title: market.title, description: [market.subtitle, market.yes_sub_title].filter(Boolean).join(' — '),
    category: market.category || '', closeTime: market.close_time || market.expiration_time || null,
    volume: amount(market.volume_24h_fp, market.volume_24h, market.volume_fp, market.volume),
    price: amount(market.last_price_dollars, market.yes_bid_dollars),
    url: `https://kalshi.com/markets/${encodeURIComponent(market.event_ticker || market.ticker)}`,
  };
}

async function fetchPolymarket() {
  const markets = [];
  for (let offset = 0, pageNumber = 0; pageNumber < MAX_PAGES; offset += POLY_PAGE_LIMIT, pageNumber += 1) {
    const payload = await getJson(`${POLYMARKET_API}/v1/markets?active=true&closed=false&limit=${POLY_PAGE_LIMIT}&offset=${offset}`);
    const page = payload.markets || [];
    markets.push(...page);
    if (page.length < POLY_PAGE_LIMIT) break;
    await sleep(75);
  }
  return [...new Map(markets.map((market) => [market.conditionId || market.id, market])).values()].map(mapPolymarket);
}

async function fetchKalshi() {
  const markets = [];
  let cursor = '';
  let pageNumber = 0;
  do {
    const query = new URLSearchParams({ status: 'open', limit: String(KALSHI_PAGE_LIMIT), mve_filter: 'exclude' });
    if (cursor) query.set('cursor', cursor);
    const page = await getJson(`${KALSHI_API}/markets?${query}`);
    markets.push(...(page.markets || []));
    cursor = page.cursor || '';
    pageNumber += 1;
    if (cursor) await sleep(150);
  } while (cursor && pageNumber < MAX_PAGES);
  return [...new Map(markets.map((market) => [market.ticker, market])).values()].map(mapKalshi);
}

/** Keep the HTTP event loop responsive while the CPU-heavy catalog comparison runs. */
function findMatchesInWorker(polymarket, kalshi) {
  return new Promise((resolveMatch, rejectMatch) => {
    const worker = new Worker(new URL('./match-worker.js', import.meta.url), {
      workerData: { polymarket, kalshi },
      execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      rejectMatch(new Error(`match engine exceeded ${MATCH_TIMEOUT_MS / 1000} seconds`));
    }, MATCH_TIMEOUT_MS);
    timeout.unref();
    worker.once('message', (result) => {
      clearTimeout(timeout);
      if (result.error) rejectMatch(new Error(result.error));
      else resolveMatch(result);
    });
    worker.once('error', (error) => { clearTimeout(timeout); rejectMatch(error); });
    worker.once('exit', (code) => {
      if (code !== 0) { clearTimeout(timeout); rejectMatch(new Error(`match worker stopped with code ${code}`)); }
    });
  });
}

export async function scanMarkets() {
  if (scanInProgress) return scanInProgress;
  snapshot = {
    ...snapshot, scanning: true, errors: [],
    sources: { polymarket: { state: 'syncing' }, kalshi: { state: 'syncing' } },
  };
  scanInProgress = (async () => {
    const [polyResult, kalshiResult] = await Promise.allSettled([fetchPolymarket(), fetchKalshi()]);
    const errors = [];
    const polymarket = polyResult.status === 'fulfilled' ? polyResult.value : [];
    const kalshi = kalshiResult.status === 'fulfilled' ? kalshiResult.value : [];
    if (polyResult.status === 'rejected') errors.push(`Polymarket: ${polyResult.reason.message}`);
    if (kalshiResult.status === 'rejected') errors.push(`Kalshi: ${kalshiResult.reason.message}`);
    let matched = { links: [], candidateCount: 0 };
    try {
      matched = await findMatchesInWorker(polymarket, kalshi);
    } catch (error) {
      errors.push(`Matcher: ${error.message}`);
    }
    let links = matched.links;
    if (process.env.OPENAI_API_KEY) {
      try { links = await reviewWithAi(links); } catch (error) { errors.push(error.message); }
    }
    snapshot = {
      links, counts: { polymarket: polymarket.length, kalshi: kalshi.length, candidates: matched.candidateCount },
      updatedAt: new Date().toISOString(), scanning: false, errors,
      sources: {
        polymarket: { state: polyResult.status === 'fulfilled' ? 'online' : 'error', markets: polymarket.length, endpoint: 'Polymarket US' },
        kalshi: { state: kalshiResult.status === 'fulfilled' ? 'online' : 'error', markets: kalshi.length, endpoint: 'Kalshi Trade API v2' },
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

if (process.env.NODE_ENV !== 'test') createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/health' && request.method === 'GET') {
      return sendJson(response, 200, { ok: true, scanning: snapshot.scanning, updatedAt: snapshot.updatedAt });
    }
    if (url.pathname === '/api/links' && request.method === 'GET') return sendJson(response, 200, snapshot);
    if (url.pathname === '/api/scan' && request.method === 'POST') {
      scanMarkets().catch(console.error);
      return sendJson(response, 202, { started: true });
    }
    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const filePath = resolve(PUBLIC_DIR, requested);
    if (!filePath.startsWith(`${resolve(PUBLIC_DIR)}${sep}`)) throw new Error('Invalid path');
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': `${MIME[extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
    response.end(body);
  } catch (error) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Crossmark is listening on 0.0.0.0:${PORT}`);
  // Give Railway's router and health check time to confirm the web process first.
  setTimeout(() => scanMarkets().catch(console.error), 10_000).unref();
  setInterval(() => scanMarkets().catch(console.error), SCAN_INTERVAL_MS).unref();
});
