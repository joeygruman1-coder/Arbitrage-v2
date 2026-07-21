import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize as normalizePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findMatches } from './matcher.js';
import { analyzePair } from './arbitrage.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(process.cwd(), 'public');
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 120000);
const MAX_POLYMARKET_PAGES = Number(process.env.MAX_POLYMARKET_PAGES || 500);
const MAX_KALSHI_PAGES = Number(process.env.MAX_KALSHI_PAGES || 100);
let snapshot = { matches: [], counts: { polymarket: 0, kalshi: 0 }, errors: [], updatedAt: null, scan: { active: false, phase: 'Waiting' } };
let scanPromise;

const number = (...values) => { for (const value of values) { const parsed = Number(value); if (Number.isFinite(parsed)) return parsed; } return 0; };
const parseJson = (value, fallback = []) => { if (Array.isArray(value)) return value; try { return JSON.parse(value); } catch { return fallback; } };

export function mapPolymarket(market) {
  const prices = parseJson(market.outcomePrices).map(Number);
  const yesAsk = number(market.bestAsk, prices[0]);
  const noAsk = market.bestBid != null ? 1 - number(market.bestBid) : number(prices[1], 1 - yesAsk);
  return { id: String(market.id || market.conditionId), title: market.question || market.title, subtitle: market.description?.slice(0, 300) || '', category: market.category || '', volume: number(market.volume24hr, market.volumeNum, market.volume), yesAsk, noAsk, feesEnabled: Boolean(market.feesEnabled), endDate: market.endDate || null, url: market.slug ? `https://polymarket.com/event/${market.slug}` : 'https://polymarket.com' };
}
function mapKalshi(market) {
  return { id: market.ticker, title: market.title, subtitle: market.subtitle || market.yes_sub_title || '', category: market.category || '', volume: number(market.volume_24h, market.volume), yesAsk: number(market.yes_ask, market.yes_ask_dollars) / (market.yes_ask_dollars ? 1 : 100), noAsk: number(market.no_ask, market.no_ask_dollars) / (market.no_ask_dollars ? 1 : 100), endDate: market.close_time || market.expiration_time || null, url: `https://kalshi.com/markets/${encodeURIComponent(market.event_ticker || market.ticker)}` };
}
async function fetchJson(url, attempt = 0) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'MarketTwin/2.0' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`${response.status} from ${new URL(url).hostname}`);
    return await response.json();
  } catch (error) {
    if (attempt >= 2) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    return fetchJson(url, attempt + 1);
  }
}
export async function fetchPolymarket() {
  const all = [];
  let cursor = '';
  for (let page = 0; page < MAX_POLYMARKET_PAGES; page += 1) {
    snapshot.scan = { active: true, phase: `Polymarket page ${page + 1}` };
    const query = new URLSearchParams({ active: 'true', closed: 'false', limit: '100' });
    if (cursor) query.set('after_cursor', cursor);
    const payload = await fetchJson(`https://gamma-api.polymarket.com/markets/keyset?${query}`);
    const markets = Array.isArray(payload.markets) ? payload.markets : [];
    all.push(...markets);
    const nextCursor = payload.next_cursor || '';
    if (!nextCursor || nextCursor === cursor || markets.length === 0) break;
    cursor = nextCursor;
  }
  return [...new Map(all.map((market) => [market.id || market.conditionId, market])).values()].map(mapPolymarket);
}
async function fetchKalshi() {
  const all = []; let cursor = '';
  for (let page = 0; page < MAX_KALSHI_PAGES; page += 1) {
    snapshot.scan = { active: true, phase: `Kalshi page ${page + 1}` };
    const query = new URLSearchParams({ status: 'open', limit: '1000', mve_filter: 'exclude' });
    if (cursor) query.set('cursor', cursor);
    const payload = await fetchJson(`https://api.elections.kalshi.com/trade-api/v2/markets?${query}`);
    all.push(...(payload.markets || [])); cursor = payload.cursor || '';
    if (!cursor) break;
  }
  return [...new Map(all.map((market) => [market.ticker, market])).values()].map(mapKalshi);
}
async function scan() {
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
    const errors = [];
    const [polyResult, kalshiResult] = await Promise.allSettled([fetchPolymarket(), fetchKalshi()]);
    const polymarket = polyResult.status === 'fulfilled' ? polyResult.value : [];
    const kalshi = kalshiResult.status === 'fulfilled' ? kalshiResult.value : [];
    if (polyResult.status === 'rejected') errors.push(`Polymarket: ${polyResult.reason.message}`);
    if (kalshiResult.status === 'rejected') errors.push(`Kalshi: ${kalshiResult.reason.message}`);
    snapshot.scan = { active: true, phase: 'Matching catalogs' };
    const matches = findMatches(polymarket, kalshi, 1000).map((match) => ({ ...match, arbitrage: analyzePair(match.polymarket, match.kalshi) }));
    snapshot = { matches, counts: { polymarket: polymarket.length, kalshi: kalshi.length }, errors, updatedAt: new Date().toISOString(), scan: { active: false, phase: 'Complete' } };
    return snapshot;
  })().finally(() => { scanPromise = null; });
  return scanPromise;
}

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
export function startServer() {
  return createServer(async (req, res) => {
  try {
    if (req.url === '/api/markets') return json(res, 200, snapshot);
    if (req.url === '/api/scan' && req.method === 'POST') { scan().catch(console.error); return json(res, 202, { started: true }); }
    const requested = req.url === '/' ? 'index.html' : req.url.split('?')[0].slice(1);
    const safePath = normalizePath(requested).replace(/^(\.\.(\/|\\|$))+/, '');
    const body = await readFile(join(PUBLIC_DIR, safePath)); res.writeHead(200, { 'Content-Type': `${mime[extname(safePath)] || 'application/octet-stream'}; charset=utf-8` }); res.end(body);
  } catch (error) { if (req.url?.startsWith('/api/')) return json(res, 502, { error: error.message }); res.writeHead(404); res.end('Not found'); }
  }).listen(PORT, () => { console.log(`Market Twin is running at http://localhost:${PORT}`); scan().catch(console.error); setInterval(() => scan().catch(console.error), SCAN_INTERVAL_MS).unref(); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
