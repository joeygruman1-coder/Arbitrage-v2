export function kalshiFee(price, contracts = 1, coefficient = 0.07) {
  return Math.ceil(coefficient * contracts * price * (1 - price) * 100) / 100;
}

export function polymarketFee(price, contracts = 1, feesEnabled = false, coefficient = 0.02) {
  return feesEnabled ? coefficient * contracts * Math.min(price, 1 - price) : 0;
}

export function analyzePair(polymarket, kalshi) {
  const routes = [
    { direction: 'Kalshi YES + Polymarket NO', kalshiPrice: kalshi.yesAsk, polyPrice: polymarket.noAsk },
    { direction: 'Kalshi NO + Polymarket YES', kalshiPrice: kalshi.noAsk, polyPrice: polymarket.yesAsk }
  ].filter((route) => route.kalshiPrice > 0 && route.polyPrice > 0);

  const analyzed = routes.map((route) => {
    const rawCost = route.kalshiPrice + route.polyPrice;
    const fees = kalshiFee(route.kalshiPrice) + polymarketFee(route.polyPrice, 1, polymarket.feesEnabled);
    const netCost = rawCost + fees;
    return { ...route, rawCost, fees, netCost, profit: 1 - netCost };
  }).sort((a, b) => a.netCost - b.netCost);
  const best = analyzed[0];
  if (!best) return { category: 'unpriced', routes: [] };
  const category = best.rawCost >= 1 ? 'overpriced' : best.netCost >= 1 ? 'fee_blocked' : 'profitable';
  return { ...best, category, routes: analyzed };
}
