import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatches, normalize, similarity } from '../matcher.js';

test('normalizes common names and punctuation', () => {
  assert.equal(normalize('Will Donald Trump win?'), 'will trump win');
});

test('scores equivalent markets above unrelated markets', () => {
  const source = { title: 'Will Trump win the 2028 US presidential election?' };
  const equivalent = { title: 'Trump to win the United States presidential election in 2028?' };
  const unrelated = { title: 'Will rainfall in Seattle exceed 2 inches this week?' };
  assert.ok(similarity(source, equivalent) > similarity(source, unrelated));
});

test('keeps the best matches first and respects the limit', () => {
  const poly = [{ id: 'p1', title: 'Will Bitcoin reach $100000 in 2026?' }];
  const kalshi = [
    { id: 'k1', title: 'Will Bitcoin hit $100000 before 2027?' },
    { id: 'k2', title: 'Will the Knicks win tonight?' }
  ];
  const result = findMatches(poly, kalshi, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].kalshi.id, 'k1');
});
