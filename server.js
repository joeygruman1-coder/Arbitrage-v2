import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize as normalizePath } from 'node:path';
import { findMatches } from './matcher.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(process.cwd(), 'public');
const CACHE_MS = 5 * 60 * 1000;
let cache = null;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapPolymarket(market) {
  const prices = parseJson(market.outcomePrices);
  return {
    id: String(market.id || market.conditionId),
    title: market.question || market.title,
    subtitle: market.description?.slice(0, 180) || '',
    category: market.category || '',
    volume: number(market.volume24hr || market.volumeNum || market.volume),
    yesPrice: number(prices[0]),
    endDate: market.endDate || market.end_date_iso || null,
    url: market.slug ? `https://polymarket.com/event/${market.slug}` : 'https://polymarket.com'
  };
}

function mapKalshi(market) {
  return {
    id: market.ticker,
    title: market.title,
    subtitle: market.subtitle || market.yes_sub_title || '',
    category: market.category || '',
    volume: number(market.volume_24h || market.volume),
    yesPrice: number(market.yes_ask || market.last_price) / 100,
    endDate: market.close_time || market.expiration_time || null,
    url: `https://kalshi.com/markets/${encodeURIComponent(market.event_ticker || market.ticker)}`
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'MarketTwin/1.0' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).hostname}`);
  return response.json();
}

async function reviewWithAI(matches) {
  if (!process.env.OPENAI_API_KEY || !matches.length) return { matches, aiEnabled: false };
  const compact = matches.slice(0, 20).map((match, index) => ({
    index, polymarket: match.polymarket.title, kalshi: match.kalshi.title
  }));
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: `You review prediction-market pairs. A true match must have the same real-world event, subject, threshold, time window, and resolution meaning. Return JSON only as {"reviews":[{"index":0,"equivalent":true,"confidence":0.9}]}. Be conservative. Pairs: ${JSON.stringify(compact)}`
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`AI review returned ${response.status}`);
  const payload = await response.json();
  const text = payload.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text || '';
  const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
  const reviews = new Map((parsed.reviews || []).map((review) => [review.index, review]));
  const reviewed = matches.map((match, index) => {
    const review = reviews.get(index);
    return review ? { ...match, score: review.equivalent ? number(review.confidence) : match.score * 0.35, aiReviewed: true } : match;
  }).sort((a, b) => b.score - a.score);
  return { matches: reviewed, aiEnabled: true };
}

async function getMarkets() {
  if (cache && Date.now() - cache.time < CACHE_MS) return cache.data;
  const results = await Promise.allSettled([
    fetchJson('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100&order=volume24hr&ascending=false'),
    fetchJson('https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=100')
  ]);
  const poly = results[0].status === 'fulfilled' ? results[0].value.map(mapPolymarket) : [];
  const rawKalshi = results[1].status === 'fulfilled' ? (results[1].value.markets || results[1].value) : [];
  const kalshi = rawKalshi.map(mapKalshi).sort((a, b) => b.volume - a.volume);
  const errors = results.flatMap((result, index) => result.status === 'rejected'
    ? [`${index === 0 ? 'Polymarket' : 'Kalshi'}: ${result.reason.message}`] : []);
  let matching = { matches: findMatches(poly, kalshi), aiEnabled: false };
  if (process.env.OPENAI_API_KEY) {
    try { matching = await reviewWithAI(matching.matches); }
    catch (error) { errors.push(`AI review: ${error.message}`); }
  }
  const data = { polymarket: poly, kalshi, ...matching, errors, updatedAt: new Date().toISOString() };
  if (poly.length || kalshi.length) cache = { time: Date.now(), data };
  return data;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  try {
    if (req.url === '/api/markets') return json(res, 200, await getMarkets());
    const requested = req.url === '/' ? 'index.html' : req.url.split('?')[0].slice(1);
    const safePath = normalizePath(requested).replace(/^(\.\.(\/|\\|$))+/, '');
    const body = await readFile(join(PUBLIC_DIR, safePath));
    res.writeHead(200, { 'Content-Type': `${mime[extname(safePath)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(body);
  } catch (error) {
    if (req.url?.startsWith('/api/')) return json(res, 502, { error: error.message });
    try {
      const body = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  }
}).listen(PORT, () => console.log(`Market Twin is running at http://localhost:${PORT}`));
