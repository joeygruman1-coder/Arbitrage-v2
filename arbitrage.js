const POLY_RATES = { crypto: .07, sports: .05, finance: .04, politics: .04, economics: .05, culture: .05, weather: .05, mentions: .04, tech: .04, geopolitics: 0 };

export function polymarketFee(price, market = {}) {
  if (!market.feesEnabled) return 0;
  const category = String(market.category || '').toLowerCase();
  const rate = Object.entries(POLY_RATES).find(([name]) => category.includes(name))?.[1] ?? .05;
  return Math.round(rate * price * (1 - price) * 100000) / 100000;
}

export function kalshiFee(price, market = {}) {
  // Standard taker rate. feeMultiplier supports series/event-specific overrides when exposed by the API.
  const multiplier = Number.isFinite(Number(market.feeMultiplier)) ? Number(market.feeMultiplier) : 1;
  const rawFee = Math.ceil((.07 * multiplier * price * (1 - price) - Number.EPSILON) * 10000) / 10000;
  // Conservatively model a one-contract, non-direct-member fill: cash balances settle to a cent.
  return Math.round((Math.ceil((price + rawFee - Number.EPSILON) * 100) / 100 - price) * 10000) / 10000;
}

function route(name, kalshiPrice, polyPrice, kalshi, poly) {
  const rawCost = kalshiPrice + polyPrice;
  const fees = kalshiFee(kalshiPrice, kalshi) + polymarketFee(polyPrice, poly);
  const netCost = rawCost + fees;
  return { name, kalshiPrice, polymarketPrice: polyPrice, rawCost, fees, netCost, profit: 1 - netCost };
}

export function analyzePair(match) {
  const { polymarket: poly, kalshi: kalshi } = match;
  const routes = [
    route('Kalshi YES + Polymarket NO', kalshi.yesAsk, poly.noAsk, kalshi, poly),
    route('Kalshi NO + Polymarket YES', kalshi.noAsk, poly.yesAsk, kalshi, poly)
  ].filter((item) => item.kalshiPrice > 0 && item.polymarketPrice > 0);
  const best = routes.sort((a, b) => a.netCost - b.netCost)[0];
  if (!best) return { ...match, category: 'unpriced', routes };
  const category = best.rawCost >= 1 ? 'overpriced' : best.netCost >= 1 ? 'fee_blocked' : 'profitable';
  return { ...match, category, bestRoute: best, routes };
}
