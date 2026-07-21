const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'before', 'by', 'for', 'from', 'in',
  'is', 'it', 'of', 'on', 'or', 'the', 'to', 'will', 'win', 'with', 'yes'
]);

export function normalize(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/\b(california|new york|united states|donald trump|joe biden)\b/g, (word) => ({
      'california': 'ca', 'new york': 'ny', 'united states': 'us',
      'donald trump': 'trump', 'joe biden': 'biden'
    })[word])
    .replace(/\bfederal reserve\b/g, 'fed')
    .replace(/\brepublican party\b|\bgop\b/g, 'republican')
    .replace(/\bdemocratic party\b/g, 'democrat')
    .replace(/\bpercent\b/g, '%')
    .replace(/[^a-z0-9%$]+/g, ' ')
    .trim();
}

export function tokens(text) {
  return new Set(normalize(text).split(/\s+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word)));
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  const common = [...left].filter((value) => right.has(value)).length;
  return common / (left.size + right.size - common);
}

function numbers(text) {
  return new Set(normalize(text).match(/\d+(?:\.\d+)?/g) || []);
}

function numberCompatibility(a, b) {
  const left = numbers(a);
  const right = numbers(b);
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0.55;
  const overlap = [...left].filter((value) => right.has(value)).length;
  return overlap / Math.max(left.size, right.size);
}

export function similarity(a, b) {
  const aTitle = a.title || '';
  const bTitle = b.title || '';
  const aText = `${aTitle} ${a.subtitle || ''}`;
  const bText = `${bTitle} ${b.subtitle || ''}`;
  const titleWords = jaccard(tokens(aTitle), tokens(bTitle));
  const detailWords = jaccard(tokens(aText), tokens(bText));
  const numeric = numberCompatibility(aTitle, bTitle);
  const categoryBonus = a.category && b.category && normalize(a.category) === normalize(b.category) ? 0.06 : 0;
  return Math.min(0.99, titleWords * 0.7 + detailWords * 0.12 + numeric * 0.12 + categoryBonus);
}

export function findMatches(polymarket, kalshi, limit = 30) {
  // Index Kalshi markets once instead of comparing every market with every
  // other market. A full catalog can contain tens of thousands of contracts;
  // the old O(P*K) loop effectively stalled before it produced any matches.
  const indexed = kalshi.map((market) => ({ market, words: tokens(market.title || '') }));
  const postings = new Map();
  indexed.forEach((entry, index) => {
    for (const word of entry.words) {
      if (!postings.has(word)) postings.set(word, []);
      postings.get(word).push(index);
    }
  });

  const candidates = [];
  for (const poly of polymarket) {
    const polyWords = tokens(poly.title || '');
    const candidateIndexes = new Set();
    for (const word of polyWords) {
      for (const index of postings.get(word) || []) candidateIndexes.add(index);
    }

    for (const index of candidateIndexes) {
      const kal = indexed[index].market;
      const sharedWords = [...polyWords].filter((word) => indexed[index].words.has(word));
      const exactNumber = [...numbers(poly.title || '')].some((value) => numbers(kal.title || '').has(value));
      if (sharedWords.length < 2 && !(sharedWords.length === 1 && exactNumber)) continue;
      const score = similarity(poly, kal);
      if (score >= 0.2) candidates.push({ polymarket: poly, kalshi: kal, score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
}
