import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePair } from '../arbitrage.js';

test('classifies all three requested pricing states', () => {
  assert.equal(analyzePair({ yesAsk: .6, noAsk: .55 }, { yesAsk: .55, noAsk: .5 }).category, 'overpriced');
  assert.equal(analyzePair({ yesAsk: .5, noAsk: .49 }, { yesAsk: .5, noAsk: .5 }).category, 'fee_blocked');
  assert.equal(analyzePair({ yesAsk: .35, noAsk: .35 }, { yesAsk: .35, noAsk: .35 }).category, 'profitable');
});
