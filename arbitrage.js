function finitePrice(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : null;
}

export function kalshiFee(price, contracts = 1, coefficient = 0.07) {
  const p = finitePrice(price);
  if (p == null) return 0;
  return Math.ceil(coefficient * contracts * p * (1 - p) * 100) / 100;
}

export function polymarketFee(price, contracts = 1, coefficient = 0) {
  const p = finitePrice(price);
  if (p == null || !coefficient) return 0;
  return coefficient * contracts * Math.min(p, 1 - p);
}

export function analyzePair(polymarket, kalshi, options = {}) {
  const contracts = Math.max(1, Number(options.contracts || 1));
  const safetyBuffer = Math.max(0, Number(options.safetyBuffer ?? 0.005));
  const polyCoefficient = Number(polymarket.feeCoefficient ?? options.polymarketFeeCoefficient ?? 0);
  const kalshiCoefficient = Number(kalshi.feeCoefficient ?? options.kalshiFeeCoefficient ?? 0.07);

  const routes = [
    {
      direction: 'Kalshi YES + Polymarket NO',
      kalshiPrice: finitePrice(kalshi.yesAsk),
      polyPrice: finitePrice(polymarket.noAsk),
    },
    {
      direction: 'Kalshi NO + Polymarket YES',
      kalshiPrice: finitePrice(kalshi.noAsk),
      polyPrice: finitePrice(polymarket.yesAsk),
    },
  ].filter((route) => route.kalshiPrice != null && route.polyPrice != null);

  const analyzed = routes.map((route) => {
    const rawCost = route.kalshiPrice + route.polyPrice;
    const fees = kalshiFee(route.kalshiPrice, contracts, kalshiCoefficient) + polymarketFee(route.polyPrice, contracts, polyCoefficient);
    const safety = safetyBuffer * contracts;
    const netCost = rawCost + fees + safety;
    return { ...route, rawCost, fees, safety, netCost, profit: 1 - netCost };
  }).sort((a, b) => a.netCost - b.netCost);

  const best = analyzed[0];
  if (!best) return { category: 'exact_match_unpriced', routes: [], reason: 'Executable YES/NO asks were unavailable.' };
  const category = best.rawCost >= 1
    ? 'match_no_gross_discount'
    : best.netCost >= 1
      ? 'gross_discount_not_profitable'
      : 'net_profitable';
  return { ...best, category, routes: analyzed };
}
