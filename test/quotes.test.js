import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveKalshiQuotes, derivePolymarketQuotes } from '../quotes.js';

test('derives executable asks from Kalshi bid-only orderbook', () => {
  const quotes = deriveKalshiQuotes({ orderbook: { yes: [[39, 20]], no: [[60, 15]] } });
  assert.equal(quotes.yesBid, 0.39);
  assert.equal(quotes.yesAsk, 0.40);
  assert.equal(quotes.noAsk, 0.61);
  assert.equal(quotes.yesQuantity, 15);
  assert.equal(quotes.noQuantity, 20);
});

test('derives Polymarket NO ask from the best live YES bid', () => {
  const quotes = derivePolymarketQuotes({ marketData: { marketSlug: 'market-a', bids: [[0.37, 8]], offers: [[0.385, 12]] } }, {}, 'market-a');
  assert.equal(quotes.yesBid, 0.37);
  assert.equal(quotes.yesAsk, 0.385);
  assert.equal(quotes.noAsk, 0.63);
});

test('rejects an order book for a different Polymarket slug', () => {
  assert.throws(() => derivePolymarketQuotes({ marketData: { marketSlug: 'wrong' } }, {}, 'expected'), /different slug/);
});
