import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePair } from '../arbitrage.js';

test('classifies the three requested pricing states plus unpriced', () => {
  const noGross = analyzePair({ yesAsk: 0.11, noAsk: 0.90 }, { yesAsk: 0.11, noAsk: 0.90 }, { safetyBuffer: 0 });
  assert.equal(noGross.category, 'match_no_gross_discount');

  const feeBlocked = analyzePair({ yesAsk: 0.49, noAsk: 0.49 }, { yesAsk: 0.50, noAsk: 0.50 }, { safetyBuffer: 0.005 });
  assert.equal(feeBlocked.category, 'gross_discount_not_profitable');

  const profitable = analyzePair({ yesAsk: 0.35, noAsk: 0.35 }, { yesAsk: 0.35, noAsk: 0.35 }, { safetyBuffer: 0.005 });
  assert.equal(profitable.category, 'net_profitable');

  assert.equal(analyzePair({ yesAsk: 0.4 }, { yesAsk: 0.5 }).category, 'exact_match_unpriced');
});
