const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'before', 'by', 'did', 'do', 'does', 'for',
  'from', 'has', 'have', 'how', 'in', 'is', 'it', 'market', 'of', 'on', 'or', 'the',
  'to', 'was', 'what', 'when', 'where', 'which', 'who', 'will', 'win', 'with', 'yes'
]);

const ALIASES = new Map([
  ['donald', 'trump'], ['president', 'presidential'], ['election', 'presidential'],
  ['championship', 'champion'], ['reach', 'above'], ['exceed', 'above'], ['hit', 'above']
]);

export function normalize(text = '') {
  return String(text).toLowerCase()
    .replace(/\bunited states\b/g, 'us').replace(/\bnew york\b/g, 'ny')
    .replace(/\bcalifornia\b/g, 'ca').replace(/\bdonald trump\b/g, 'trump')
    .replace(/\bjoe biden\b/g, 'biden').replace(/[^a-z0-9%$]+/g, ' ').trim();
}

export function tokens(text) {
  return new Set(normalize(text).split(/\s+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word)).map((word) => ALIASES.get(word) || word));
}

function numbers(text) { return normalize(text).match(/\d+(?:\.\d+)?/g) || []; }
function intersection(a, b) { return [...a].filter((value) => b.has(value)); }

export function similarity(a, b) {
  const aText = `${a.title || ''} ${a.subtitle || ''}`;
  const bText = `${b.title || ''} ${b.subtitle || ''}`;
  const left = tokens(aText); const right = tokens(bText);
  if (!left.size || !right.size) return 0;
  const common = intersection(left, right).length;
  const containment = common / Math.min(left.size, right.size);
  const jaccard = common / (left.size + right.size - common);
  const leftNumbers = numbers(aText); const rightNumbers = numbers(bText);
  const numeric = !leftNumbers.length && !rightNumbers.length ? 1
    : leftNumbers.length && rightNumbers.length && leftNumbers.every((n) => rightNumbers.includes(n)) ? 1 : 0;
  const dates = a.endDate && b.endDate ? Math.abs(new Date(a.endDate) - new Date(b.endDate)) / 86400000 : null;
  const dateScore = dates === null ? 0.5 : dates <= 2 ? 1 : dates <= 32 ? 0.55 : 0;
  return Math.min(.99, containment * .48 + jaccard * .28 + numeric * .16 + dateScore * .08);
}

/** Match large collections without comparing every possible pair. */
export function findMatches(polymarket, kalshi, limit = 1000) {
  const index = new Map();
  kalshi.forEach((market, i) => tokens(`${market.title} ${market.subtitle}`).forEach((token) => {
    if (!index.has(token)) index.set(token, []);
    index.get(token).push(i);
  }));
  const candidates = [];
  for (const poly of polymarket) {
    const votes = new Map();
    for (const token of tokens(`${poly.title} ${poly.subtitle}`)) {
      const bucket = index.get(token) || [];
      // Very common terms add noise and can explode memory.
      if (bucket.length > 1500) continue;
      bucket.forEach((i) => votes.set(i, (votes.get(i) || 0) + 1));
    }
    const best = [...votes.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 35);
    for (const [i] of best) {
      const score = similarity(poly, kalshi[i]);
      if (score >= .42) candidates.push({ polymarket: poly, kalshi: kalshi[i], score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
}
