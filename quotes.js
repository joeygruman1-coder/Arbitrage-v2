function number(...values) {
  for (const value of values) {
    const candidate = value && typeof value === 'object' && 'value' in value ? value.value : value;
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizedPrice(...values) {
  const value = number(...values);
  if (value == null) return null;
  return value > 1 ? value / 100 : value;
}

export function parseBookLevels(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (Array.isArray(row)) return { price: normalizedPrice(row[0]), quantity: number(row[1]) || 0 };
    return { price: normalizedPrice(row?.px, row?.price), quantity: number(row?.qty, row?.quantity, row?.size) || 0 };
  }).filter((level) => level.price != null && level.quantity > 0);
}

export function derivePolymarketQuotes(payload, fallback = {}, expectedSlug = '') {
  const data = payload?.marketData || payload?.market_data || payload || {};
  const returnedSlug = String(data.marketSlug || data.market_slug || '').trim();
  if (expectedSlug && returnedSlug && returnedSlug !== expectedSlug) throw new Error(`Polymarket book returned a different slug: ${returnedSlug}`);
  const bids = parseBookLevels(data.bids).sort((a, b) => b.price - a.price);
  const offers = parseBookLevels(data.offers || data.asks).sort((a, b) => a.price - b.price);
  const yesBid = bids[0]?.price ?? fallback.yesBid ?? null;
  const yesAsk = offers[0]?.price ?? fallback.yesAsk ?? null;
  return {
    yesBid,
    yesAsk,
    noAsk: yesBid != null ? 1 - yesBid : fallback.noAsk ?? null,
    yesQuantity: offers[0]?.quantity ?? null,
    noQuantity: bids[0]?.quantity ?? null,
  };
}

export function deriveKalshiQuotes(payload, fallback = {}) {
  const data = payload?.orderbook_fp || payload?.orderbook || payload || {};
  const yesBids = parseBookLevels(data.yes).sort((a, b) => b.price - a.price);
  const noBids = parseBookLevels(data.no).sort((a, b) => b.price - a.price);
  const yesBid = yesBids[0]?.price ?? fallback.yesBid ?? null;
  const noBid = noBids[0]?.price ?? null;
  return {
    yesBid,
    yesAsk: noBid != null ? 1 - noBid : fallback.yesAsk ?? null,
    noAsk: yesBid != null ? 1 - yesBid : fallback.noAsk ?? null,
    yesQuantity: noBids[0]?.quantity ?? null,
    noQuantity: yesBids[0]?.quantity ?? null,
  };
}
