import { normalizeKalshi, normalizePolymarket, tokenJaccard } from './normalizer.js';

function overlapCount(a, b) {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

function containment(a, b) {
  if (!a.size || !b.size) return 0;
  return overlapCount(a, b) / Math.min(a.size, b.size);
}

function datesCompatible(a, b) {
  if (a.boundaryDate || b.boundaryDate) {
    if (!a.boundaryDate || !b.boundaryDate) return { compatible: true, score: 0.6, reason: 'deadline missing on one side' };
    if (a.boundaryDate === b.boundaryDate) return { compatible: true, score: 1, reason: 'same settlement deadline' };
    return { compatible: false, score: 0, reason: `different settlement deadlines (${a.boundaryDate} vs ${b.boundaryDate})` };
  }
  if (!a.date || !b.date) return { compatible: true, score: 0.55, reason: 'date missing on one side' };
  if (a.date === b.date) return { compatible: true, score: 1, reason: 'same date' };
  return { compatible: false, score: 0, reason: `different dates (${a.date} vs ${b.date})` };
}

function timesCompatible(a, b) {
  if (a.sector !== 'sports' || b.sector !== 'sports') return { compatible: true, score: 1, reason: 'not a scheduled sports start' };
  if (!a.eventTime || !b.eventTime || !a.eventTimeReliable || !b.eventTimeReliable) return { compatible: true, score: 0.65, reason: 'verified start time missing on one side' };
  const gapMinutes = Math.abs(Date.parse(a.eventTime) - Date.parse(b.eventTime)) / 60000;
  if (gapMinutes <= 75) return { compatible: true, score: Math.max(0.75, 1 - gapMinutes / 300), reason: `start times within ${Math.round(gapMinutes)} minutes` };
  return { compatible: false, score: 0, reason: `different start times (${Math.round(gapMinutes)} minutes apart)` };
}

function thresholdsCompatible(a, b) {
  const needsLine = ['spread','total','threshold'].includes(a.contractKind) || ['spread','total','threshold'].includes(b.contractKind) || a.threshold != null || b.threshold != null;
  if (!needsLine) return { compatible: true, score: 1, reason: 'no line required' };
  if (a.threshold == null || b.threshold == null) return { compatible: false, score: 0, reason: 'line missing on one side' };
  if (Math.abs(a.threshold - b.threshold) > 0.011) return { compatible: false, score: 0, reason: `different lines (${a.threshold} vs ${b.threshold})` };
  if (a.comparator && b.comparator && a.comparator !== b.comparator) return { compatible: false, score: 0, reason: `different directions (${a.comparator} vs ${b.comparator})` };
  return { compatible: true, score: 1, reason: 'same line' };
}

function outcomeAlignment(a, b) {
  const sameOutcome = Math.max(tokenJaccard(a.outcomeTokens, b.outcomeTokens), containment(a.outcomeTokens, b.outcomeTokens));
  const sameSubject = Math.max(tokenJaccard(a.subjectTokens, b.subjectTokens), containment(a.subjectTokens, b.subjectTokens));
  const same = Math.max(sameOutcome, sameSubject);
  const opposite = Math.max(
    tokenJaccard(a.outcomeTokens, b.oppositeOutcomeTokens),
    tokenJaccard(a.oppositeOutcomeTokens, b.outcomeTokens),
    containment(a.outcomeTokens, b.oppositeOutcomeTokens),
    containment(a.oppositeOutcomeTokens, b.outcomeTokens),
  );
  if (same >= 0.55) return { alignment: 'same', score: same };
  if (a.subjectTokens.size && b.subjectTokens.size && sameSubject < 0.55) return { alignment: 'conflict', score: sameSubject };
  if (a.boundaryDate && b.boundaryDate && a.boundaryDate === b.boundaryDate) {
    const event = Math.max(tokenJaccard(a.eventTokens, b.eventTokens), containment(a.eventTokens, b.eventTokens));
    if (event >= 0.45) return { alignment: 'same', score: Math.max(0.8, event) };
  }
  if (opposite >= 0.55) return { alignment: 'opposite', score: opposite };
  if (!a.outcomeTokens.size && !b.outcomeTokens.size) return { alignment: 'same', score: 0.8 };
  if (!a.outcomeTokens.size || !b.outcomeTokens.size) return { alignment: 'unknown', score: 0.45 };
  return { alignment: 'conflict', score: Math.max(same, opposite) };
}

function participantCompatibility(a, b) {
  const score = Math.max(tokenJaccard(a.participantTokens, b.participantTokens), containment(a.participantTokens, b.participantTokens));
  const shared = overlapCount(a.participantTokens, b.participantTokens);
  if (a.sector !== 'sports' && b.sector !== 'sports') return { compatible: true, score: Math.max(score, 0.5), reason: 'not a scheduled sports fixture' };
  if (!a.participantTokens.size || !b.participantTokens.size) return { compatible: false, score, reason: 'sports participants missing' };
  if (shared < 2 || score < 0.5) return { compatible: false, score, reason: 'different competitors' };
  return { compatible: true, score, reason: 'same competitors' };
}

function structuralGuard(a, b) {
  if (!a.id || !b.id) return { accepted: false, reason: 'missing provider market ID' };
  if ((a.sector === 'sports') !== (b.sector === 'sports')) return { accepted: false, reason: 'sports/non-sports conflict' };
  if (a.sector !== b.sector && !['other',''].includes(a.sector) && !['other',''].includes(b.sector)) return { accepted: false, reason: `different sectors (${a.sector} vs ${b.sector})` };
  if (a.contractKind !== b.contractKind) return { accepted: false, reason: `different contract types (${a.contractKind} vs ${b.contractKind})` };
  if (a.resolutionAction && b.resolutionAction && a.resolutionAction !== b.resolutionAction) return { accepted: false, reason: `different settlement actions (${a.resolutionAction} vs ${b.resolutionAction})` };
  if (a.segment !== b.segment) return { accepted: false, reason: `different segments (${a.segment} vs ${b.segment})` };
  if (a.ordinal != null && b.ordinal != null && a.ordinal !== b.ordinal) return { accepted: false, reason: `different game/map/set ordinal (${a.ordinal} vs ${b.ordinal})` };
  if (a.eventId && b.eventId && a.eventId !== b.eventId && a.sector === 'sports') return { accepted: false, reason: 'different structured event IDs' };
  if (a.propType && b.propType && a.propType !== b.propType) return { accepted: false, reason: `different proposition types (${a.propType} vs ${b.propType})` };
  if (a.selectionScope && b.selectionScope && a.selectionScope !== b.selectionScope) return { accepted: false, reason: `different proposition scope (${a.selectionScope} vs ${b.selectionScope})` };
  const date = datesCompatible(a, b);
  if (!date.compatible) return { accepted: false, reason: date.reason };
  const time = timesCompatible(a, b);
  if (!time.compatible) return { accepted: false, reason: time.reason };
  const line = thresholdsCompatible(a, b);
  if (!line.compatible) return { accepted: false, reason: line.reason };
  const participants = participantCompatibility(a, b);
  if (!participants.compatible) return { accepted: false, reason: participants.reason };
  const outcome = outcomeAlignment(a, b);
  if (outcome.alignment === 'conflict') return { accepted: false, reason: 'different selected outcomes' };
  return { accepted: true, date, time, line, participants, outcome };
}

function scorePair(a, b, guard) {
  const eventJaccard = tokenJaccard(a.eventTokens, b.eventTokens);
  const eventContainment = containment(a.eventTokens, b.eventTokens);
  const eventScore = Math.max(eventJaccard, eventContainment * 0.92);
  const sharedEventTokens = overlapCount(a.eventTokens, b.eventTokens);
  const idBonus = a.eventId && b.eventId && a.eventId === b.eventId ? 0.08 : 0;
  const seriesBonus = a.seriesId && b.seriesId && a.seriesId === b.seriesId ? 0.04 : 0;
  const score = Math.min(0.999,
    eventScore * 0.42 + guard.outcome.score * 0.23 + guard.participants.score * 0.14 +
    guard.date.score * 0.08 + guard.time.score * 0.05 + guard.line.score * 0.04 +
    0.04 + idBonus + seriesBonus
  );
  return { score, eventScore, sharedEventTokens };
}

function isExact(a, b, guard, scored) {
  if (a.sector === 'sports') {
    return guard.date.score === 1 && guard.participants.score >= 0.5 && guard.outcome.score >= 0.55 && scored.eventScore >= 0.42 && scored.sharedEventTokens >= 1 && scored.score >= 0.72;
  }
  const numberSensitive = ['threshold','spread','total'].includes(a.contractKind) || a.threshold != null || b.threshold != null;
  if (a.boundaryDate && b.boundaryDate && a.boundaryDate === b.boundaryDate) {
    return guard.outcome.score >= 0.55 && scored.eventScore >= 0.35 && scored.sharedEventTokens >= 1 && (!numberSensitive || guard.line.score === 1) && scored.score >= 0.62;
  }
  if (a.contractKind === 'winner') return guard.outcome.score >= 0.7 && scored.eventScore >= 0.42 && scored.sharedEventTokens >= 2 && scored.score >= 0.66;
  return guard.outcome.score >= 0.55 && scored.eventScore >= 0.5 && scored.sharedEventTokens >= 2 && (!numberSensitive || guard.line.score === 1) && scored.score >= 0.7;
}

function candidateIndexes(poly, postings, kalshi, tokenFrequency, maxCandidates) {
  const weighted = new Map();
  const sourceTokens = new Set([...poly.eventTokens, ...poly.participantTokens, ...poly.outcomeTokens, ...poly.subjectTokens]);
  for (const token of sourceTokens) {
    const rows = postings.get(token) || [];
    const rarity = 1 / Math.max(1, tokenFrequency.get(token) || rows.length || 1);
    for (const index of rows) weighted.set(index, (weighted.get(index) || 0) + rarity);
  }
  if (!weighted.size) {
    for (let index = 0; index < kalshi.length; index += 1) {
      if (kalshi[index].sector === poly.sector) weighted.set(index, 0.0001);
      if (weighted.size >= maxCandidates) break;
    }
  }
  return [...weighted.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxCandidates).map(([index]) => index);
}

function normalizeCatalog(markets, venue) {
  const normalize = venue === 'kalshi' ? normalizeKalshi : normalizePolymarket;
  return markets.map(normalize).filter((market) => market.id && market.title);
}

export function findMatches(polymarketRaw, kalshiRaw, options = {}) {
  const limit = typeof options === 'number' ? options : Number(options.limit || 1000);
  const maxCandidates = typeof options === 'object' ? Number(options.maxCandidates || 120) : 120;
  const includeNear = typeof options === 'object' ? Boolean(options.includeNear) : false;
  const polymarket = normalizeCatalog(polymarketRaw, 'polymarket_us');
  const kalshi = normalizeCatalog(kalshiRaw, 'kalshi');

  const postings = new Map();
  const tokenFrequency = new Map();
  kalshi.forEach((market, index) => {
    const allTokens = new Set([...market.eventTokens, ...market.participantTokens, ...market.outcomeTokens, ...market.subjectTokens]);
    for (const token of allTokens) {
      if (!postings.has(token)) postings.set(token, []);
      postings.get(token).push(index);
      tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
    }
  });

  const exact = [];
  const near = [];
  const rejected = [];
  let evaluated = 0;
  for (const poly of polymarket) {
    for (const index of candidateIndexes(poly, postings, kalshi, tokenFrequency, maxCandidates)) {
      const kal = kalshi[index];
      evaluated += 1;
      const guard = structuralGuard(poly, kal);
      if (!guard.accepted) {
        if (rejected.length < 300) rejected.push({ polymarket: poly, kalshi: kal, reason: guard.reason });
        continue;
      }
      const scored = scorePair(poly, kal, guard);
      const pair = {
        pairId: `${kal.id}|${poly.id}`,
        polymarket: poly,
        kalshi: kal,
        score: scored.score,
        tier: isExact(poly, kal, guard, scored) ? 'exact' : 'near',
        alignment: guard.outcome.alignment,
        reason: `${guard.participants.reason}; ${guard.date.reason}; ${guard.time.reason}; ${guard.line.reason}; outcome ${guard.outcome.alignment}`,
        features: {
          eventScore: scored.eventScore,
          outcomeScore: guard.outcome.score,
          participantScore: guard.participants.score,
          dateScore: guard.date.score,
          timeScore: guard.time.score,
          contractKind: poly.contractKind,
          threshold: poly.threshold,
          boundaryDate: poly.boundaryDate,
          propType: poly.propType,
          selectionScope: poly.selectionScope,
          resolutionAction: poly.resolutionAction,
        },
      };
      if (pair.tier === 'exact') exact.push(pair);
      else if (includeNear && pair.score >= 0.62) near.push(pair);
    }
  }

  const claimedPoly = new Set();
  const claimedKalshi = new Set();
  const selected = [];
  for (const pair of exact.sort((a, b) => b.score - a.score)) {
    if (claimedPoly.has(pair.polymarket.id) || claimedKalshi.has(pair.kalshi.id)) continue;
    claimedPoly.add(pair.polymarket.id);
    claimedKalshi.add(pair.kalshi.id);
    selected.push(pair);
    if (selected.length >= limit) break;
  }

  return {
    matches: selected,
    near: includeNear ? near.sort((a, b) => b.score - a.score).slice(0, Math.min(limit, 200)) : [],
    rejected,
    counts: { polymarket: polymarket.length, kalshi: kalshi.length, evaluated, exactCandidates: exact.length },
  };
}

export function similarity(aRaw, bRaw) {
  const a = normalizePolymarket(aRaw);
  const b = normalizeKalshi(bRaw);
  const guard = structuralGuard(a, b);
  if (!guard.accepted) return 0;
  return scorePair(a, b, guard).score;
}

export { structuralGuard, outcomeAlignment };
