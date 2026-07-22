const STOP_WORDS = new Set('a an and are as at be by did do does for from has have how i in is it of on or than that the this to vs versus was were what when where which who will with would yes no'.split(' '));
const ALIASES = [
  [/\bunited states of america\b|\bunited states\b|\bu\.?s\.?a?\.?(?=\s|$)/g, ' us '],
  [/\bdonald j\.? trump\b|\bdonald trump\b/g, ' trump '],
  [/\bjoseph r\.? biden\b|\bjoe biden\b/g, ' biden '],
  [/\bgreater than\b|\bmore than\b|\bover\b/g, ' above '],
  [/\bless than\b|\bunder\b/g, ' below '],
  [/\bwin(s|ning)?\b/g, ' win '],
  [/\belections?\b/g, ' election '],
];

export function normalizeText(value = '') {
  let text = String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const [pattern, replacement] of ALIASES) text = text.replace(pattern, replacement);
  return text.replace(/(\d),(?=\d)/g, '$1').replace(/[^a-z0-9.%$+-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tokens(value = '') {
  return new Set(normalizeText(value).split(' ').filter((word) => word.length > 1 && !STOP_WORDS.has(word)));
}

function numbers(value = '') {
  return [...normalizeText(value).matchAll(/(?:\$)?-?\d+(?:\.\d+)?%?/g)].map((match) => match[0].replace('$', ''));
}

function directions(value = '') {
  const text = ` ${normalizeText(value)} `;
  return new Set(['above', 'below', 'before', 'after'].filter((word) => text.includes(` ${word} `)));
}

function selectedOutcome(value = '') {
  const text = normalizeText(value);
  const beforeWin = text.match(/\b([a-z0-9]+)\s+(?:to\s+)?win\b/);
  return beforeWin?.[1] && !STOP_WORDS.has(beforeWin[1]) ? beforeWin[1] : null;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function intersectionSize(left, right) {
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared;
}

function prepare(market, exchange) {
  const title = String(market.title || market.question || '').trim();
  const details = String(market.description || market.subtitle || market.rules || '').slice(0, 1200);
  const combined = `${title} ${details}`;
  return { ...market, exchange, title, _tokens: tokens(title), _detailTokens: tokens(combined), _numbers: numbers(title), _directions: directions(title), _outcome: selectedOutcome(title) };
}

function scorePair(poly, kalshi) {
  const sharedTitle = intersectionSize(poly._tokens, kalshi._tokens);
  if (!sharedTitle) return null;
  const titleScore = jaccard(poly._tokens, kalshi._tokens);
  const detailScore = jaccard(poly._detailTokens, kalshi._detailTokens);
  const leftNumbers = new Set(poly._numbers);
  const rightNumbers = new Set(kalshi._numbers);
  const numbersAgree = leftNumbers.size === rightNumbers.size && [...leftNumbers].every((number) => rightNumbers.has(number));
  if ((leftNumbers.size || rightNumbers.size) && !numbersAgree) return null;
  if (poly._outcome && kalshi._outcome && poly._outcome !== kalshi._outcome) return null;
  if ([...poly._directions].some((direction) => !kalshi._directions.has(direction)) || [...kalshi._directions].some((direction) => !poly._directions.has(direction))) return null;
  const categoryConflict = poly.category && kalshi.category && normalizeText(poly.category) !== normalizeText(kalshi.category);
  const score = Math.min(0.99, titleScore * 0.72 + detailScore * 0.18 + (numbersAgree ? 0.06 : 0) + (sharedTitle >= 3 ? 0.08 : 0) - (categoryConflict ? 0.04 : 0));
  if (sharedTitle < 2 || score < 0.38) return null;
  return { score, sharedTitle, numbersAgree };
}

const clean = ({ _tokens, _detailTokens, _numbers, _directions, _outcome, ...market }) => market;

/** Build a one-to-one set of links: a market can occur in at most one pair. */
export function findMatches(polymarketMarkets, kalshiMarkets, { limit = 250, minimumScore = 0.48 } = {}) {
  const polymarket = polymarketMarkets.map((market) => prepare(market, 'polymarket')).filter((market) => market.id && market.title);
  const kalshi = kalshiMarkets.map((market) => prepare(market, 'kalshi')).filter((market) => market.id && market.title);
  const index = new Map();
  kalshi.forEach((market, marketIndex) => {
    for (const token of market._tokens) {
      if (!index.has(token)) index.set(token, new Set());
      index.get(token).add(marketIndex);
    }
  });

  const candidates = [];
  for (const poly of polymarket) {
    const possible = new Set();
    for (const token of poly._tokens) for (const marketIndex of index.get(token) || []) possible.add(marketIndex);
    for (const marketIndex of possible) {
      const kal = kalshi[marketIndex];
      const scored = scorePair(poly, kal);
      if (scored && scored.score >= minimumScore) candidates.push({ poly, kal, ...scored });
    }
  }

  const usedPoly = new Set();
  const usedKalshi = new Set();
  const links = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (usedPoly.has(candidate.poly.id) || usedKalshi.has(candidate.kal.id)) continue;
    usedPoly.add(candidate.poly.id);
    usedKalshi.add(candidate.kal.id);
    links.push({
      id: `${candidate.poly.id}::${candidate.kal.id}`,
      polymarket: clean(candidate.poly),
      kalshi: clean(candidate.kal),
      confidence: Math.round(candidate.score * 100),
      status: candidate.score >= 0.72 ? 'high' : 'review',
      explanation: candidate.numbersAgree
        ? `Shares ${candidate.sharedTitle} important title words and all title numbers agree.`
        : `Shares ${candidate.sharedTitle} important title words; no conflicting title numbers were found.`,
    });
    if (links.length >= limit) break;
  }
  return { links, candidateCount: candidates.length };
}
