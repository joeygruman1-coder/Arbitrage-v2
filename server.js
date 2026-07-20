import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize as normalizePath } from 'node:path';
import { findMatches } from './matcher.js';
import { analyzePair } from './arbitrage.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(process.cwd(), 'public');
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 2 * 60 * 1000);
const MAX_POLYMARKET_PAGES = Number(process.env.MAX_POLYMARKET_PAGES || 500);
const MAX_KALSHI_PAGES = Number(process.env.MAX_KALSHI_PAGES || 100);
const POLYMARKET_CONCURRENCY = Math.max(1, Number(process.env.POLYMARKET_CONCURRENCY || 5));

let snapshot = { polymarket: [], kalshi: [], matches: [], errors: [], updatedAt: null, scan: { active: true, phase: 'Starting scanner', pages: 0 } };
let scanPromise = null;

const num = (...values) => {
  for (const value of values) { const parsed = Number(value); if (Number.isFinite(parsed)) return parsed; }
  return 0;
};
const parseJson = (value, fallback = []) => { if (Array.isArray(value)) return value; try { return JSON.parse(value); } catch { return fallback; } };

function mapPolymarket(market) {
  const prices = parseJson(market.outcomePrices).map(Number);
  const outcomes = parseJson(market.outcomes);
  const yesIndex = Math.max(0, outcomes.findIndex((outcome) => String(outcome).toLowerCase() === 'yes'));
  const midYes = num(prices[yesIndex]);
  const yesAsk = num(market.bestAsk, midYes);
  const noAsk = market.bestBid !== undefined ? 1 - num(market.bestBid) : num(prices[yesIndex === 0 ? 1 : 0], 1 - midYes);
  return {
    id: String(market.id || market.conditionId), conditionId: market.conditionId,
    title: market.question || market.title, subtitle: market.description?.slice(0, 400) || '',
    category: market.category || market.events?.[0]?.category || '', volume: num(market.volume24hr, market.volumeNum, market.volume),
    yesAsk, noAsk, feesEnabled: Boolean(market.feesEnabled), endDate: market.endDate || market.end_date_iso || null,
    url: market.slug ? `https://polymarket.com/event/${market.slug}` : 'https://polymarket.com'
  };
}

function mapKalshi(market) {
  return {
    id: market.ticker, title: market.title, subtitle: `${market.subtitle || market.yes_sub_title || ''} ${market.rules_primary || ''}`.slice(0, 400),
    category: market.category || market.series_ticker || '', volume: num(market.volume_24h_fp, market.volume_24h, market.volume_fp, market.volume),
    yesAsk: num(market.yes_ask_dollars, market.yes_ask ? market.yes_ask / 100 : 0),
    noAsk: num(market.no_ask_dollars, market.no_ask ? market.no_ask / 100 : 0),
    feeMultiplier: num(market.fee_multiplier, 1), endDate: market.close_time || market.expiration_time || null,
    url: `https://kalshi.com/markets/${encodeURIComponent(market.event_ticker || market.ticker)}`
  };
}

async function fetchJson(url, attempts = 3) {
  let error;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'MarketTwin/2.0' }, signal: AbortSignal.timeout(25000) });
      if (response.status === 429 || response.status >= 500) throw new Error(`${response.status} from ${new URL(url).hostname}`);
      if (!response.ok) throw new Error(`${response.status} from ${new URL(url).hostname}`);
      return response.json();
    } catch (caught) { error = caught; if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt)); }
  }
  throw error;
}

async function fetchAllPolymarket() {
  // Gamma currently caps a page at 100 even when a larger limit is requested.
  const markets = []; const limit = 100;
  for (let page = 0; page < MAX_POLYMARKET_PAGES; page += POLYMARKET_CONCURRENCY) {
    const pageNumbers = Array.from(
      { length: Math.min(POLYMARKET_CONCURRENCY, MAX_POLYMARKET_PAGES - page) },
      (_, index) => page + index
    );
    snapshot.scan = { active: true, phase: 'Downloading Polymarket', pages: page + 1, polymarket: markets.length, kalshi: snapshot.scan.kalshi || 0 };
    const batches = await Promise.all(pageNumbers.map((pageNumber) => fetchJson(
      `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=${limit}&offset=${pageNumber * limit}`
    )));
    for (const batch of batches) markets.push(...batch);
    if (batches.some((batch) => batch.length < limit)) break;
  }
  const unique = new Map(markets.map((market) => [String(market.id || market.conditionId), market]));
  return [...unique.values()].map(mapPolymarket).filter((market) => market.title && market.yesAsk > 0 && market.noAsk > 0);
}

async function fetchAllKalshi() {
  const markets = []; let cursor = '';
  for (let page = 0; page < MAX_KALSHI_PAGES; page++) {
    snapshot.scan = { active: true, phase: 'Downloading Kalshi', pages: page + 1, polymarket: snapshot.scan.polymarket || 0, kalshi: markets.length };
    const query = new URLSearchParams({ status: 'open', limit: '1000', mve_filter: 'exclude' });
    if (cursor) query.set('cursor', cursor);
    const data = await fetchJson(`https://api.elections.kalshi.com/trade-api/v2/markets?${query}`);
    markets.push(...(data.markets || [])); cursor = data.cursor;
    if (!cursor) break;
  }
  return markets.map(mapKalshi).filter((market) => market.title && market.yesAsk > 0 && market.noAsk > 0);
}

async function reviewWithAI(matches) {
  if (!process.env.OPENAI_API_KEY || !matches.length) return { matches, aiEnabled: false };
  const selected = matches.slice(0, 80);
  const pairs = selected.map((m, index) => ({ index, polymarket: m.polymarket.title, kalshi: m.kalshi.title, polyClose: m.polymarket.endDate, kalshiClose: m.kalshi.endDate }));
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', input: `Determine whether each pair has exactly the same settlement event, subject, threshold, direction, and time window. Be conservative. Output JSON only: {"reviews":[{"index":0,"equivalent":true,"confidence":0.9}]}. ${JSON.stringify(pairs)}` }),
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`AI review returned ${response.status}`);
  const payload = await response.json();
  const output = payload.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text || '';
  const reviews = new Map((JSON.parse(output.replace(/^```json\s*|\s*```$/g, '')).reviews || []).map((review) => [review.index, review]));
  return { aiEnabled: true, matches: matches.map((match, index) => {
    const review = reviews.get(index); return review ? { ...match, score: review.equivalent ? num(review.confidence) : match.score * .2, aiReviewed: true } : match;
  }).filter((match) => match.score >= .42).sort((a, b) => b.score - a.score) };
}

async function runScan() {
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
    const started = Date.now(); const startedAt = new Date(started).toISOString(); const errors = [];
    try {
      const [polyResult, kalshiResult] = await Promise.allSettled([fetchAllPolymarket(), fetchAllKalshi()]);
      const polymarket = polyResult.status === 'fulfilled' ? polyResult.value : snapshot.polymarket;
      const kalshi = kalshiResult.status === 'fulfilled' ? kalshiResult.value : snapshot.kalshi;
      if (polyResult.status === 'rejected') errors.push(`Polymarket: ${polyResult.reason.message}`);
      if (kalshiResult.status === 'rejected') errors.push(`Kalshi: ${kalshiResult.reason.message}`);
      snapshot.scan = { active: true, phase: 'Matching contracts', pages: 0, polymarket: polymarket.length, kalshi: kalshi.length };
      let matching = { matches: findMatches(polymarket, kalshi), aiEnabled: false };
      try { matching = await reviewWithAI(matching.matches); } catch (error) { errors.push(`AI: ${error.message}`); }
      const matches = matching.matches.map(analyzePair);
      snapshot = { polymarket, kalshi, matches, aiEnabled: matching.aiEnabled, errors, updatedAt: new Date().toISOString(), scan: { active: false, phase: 'Waiting for next scan', startedAt, durationMs: Date.now() - started, nextAt: new Date(Date.now() + SCAN_INTERVAL_MS).toISOString(), polymarket: polymarket.length, kalshi: kalshi.length } };
    } catch (error) { errors.push(error.message); snapshot = { ...snapshot, errors, scan: { active: false, phase: 'Scan failed; retry scheduled', nextAt: new Date(Date.now() + SCAN_INTERVAL_MS).toISOString() } }; }
    finally { scanPromise = null; }
    return snapshot;
  })();
  return scanPromise;
}

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

function clientSnapshot() {
  return {
    counts: { polymarket: snapshot.polymarket.length, kalshi: snapshot.kalshi.length, matches: snapshot.matches.length },
    matches: snapshot.matches, aiEnabled: snapshot.aiEnabled, errors: snapshot.errors,
    updatedAt: snapshot.updatedAt, scan: snapshot.scan
  };
}

createServer(async (req, res) => {
  try {
    if (req.url === '/api/markets') {
      if (!snapshot.updatedAt && scanPromise) await Promise.race([scanPromise, new Promise((resolve) => setTimeout(resolve, 12000))]);
      // Do not send tens of thousands of source records to every polling browser.
      return json(res, 200, clientSnapshot());
    }
    if (req.url === '/api/scan' && req.method === 'POST') { runScan(); return json(res, 202, { started: true }); }
    const requested = req.url === '/' ? 'index.html' : req.url.split('?')[0].slice(1);
    const safePath = normalizePath(requested).replace(/^(\.\.(\/|\\|$))+/, ''); const body = await readFile(join(PUBLIC_DIR, safePath));
    res.writeHead(200, { 'Content-Type': `${mime[extname(safePath)] || 'application/octet-stream'}; charset=utf-8` }); res.end(body);
  } catch (error) { if (req.url?.startsWith('/api/')) return json(res, 500, { error: error.message }); res.writeHead(404); res.end('Not found'); }
}).listen(PORT, () => console.log(`Market Twin scanner is running at http://localhost:${PORT}`));

runScan();
const timer = setInterval(runScan, SCAN_INTERVAL_MS); timer.unref();
