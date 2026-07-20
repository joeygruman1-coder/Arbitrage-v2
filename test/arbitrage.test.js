import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePair, kalshiFee, polymarketFee } from '../arbitrage.js';

const pair = (kalshiYes, kalshiNo, polyYes, polyNo, feesEnabled = false) => ({ score: .9, kalshi: { yesAsk: kalshiYes, noAsk: kalshiNo }, polymarket: { yesAsk: polyYes, noAsk: polyNo, feesEnabled, category: 'politics' } });

test('uses the Kalshi taker curve and retail balance rounding', () => assert.equal(kalshiFee(.5), .02));
test('does not charge a Polymarket fee on fee-free markets', () => assert.equal(polymarketFee(.5, { feesEnabled: false }), 0));
test('uses the category rate on fee-enabled Polymarket markets', () => assert.equal(polymarketFee(.5, { feesEnabled: true, category: 'Politics' }), .01));
test('classifies a truly profitable route after fees', () => assert.equal(analyzePair(pair(.4, .6, .6, .5)).category, 'profitable'));
test('classifies raw discounts consumed by fees', () => assert.equal(analyzePair(pair(.49, .51, .51, .5, true)).category, 'fee_blocked'));
test('classifies pairs whose cheapest route costs at least $1', () => assert.equal(analyzePair(pair(.55, .55, .55, .55)).category, 'overpriced'));
