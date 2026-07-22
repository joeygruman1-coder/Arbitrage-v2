import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatches, normalizeText, tokens } from '../matcher.js';

test('normalizes aliases, accents, and punctuation', () => {
  assert.equal(normalizeText('Will Donald J. Trump win the U.S. election?'), 'will trump win the us election');
  assert.deepEqual([...tokens('Who will win the election?')], ['win', 'election']);
});

test('links equivalent questions and rejects conflicting thresholds', () => {
  const polymarket = [{ id: 'p1', title: 'Will Bitcoin be above $100000 in 2027?', description: 'Resolves yes above $100000.' }];
  const kalshi = [
    { id: 'k1', title: 'Will Bitcoin be over $100000 in 2027?', description: 'Yes above $100000.' },
    { id: 'k2', title: 'Will Bitcoin be above $150000 in 2027?' },
  ];
  const result = findMatches(polymarket, kalshi, { minimumScore: 0.3 });
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].kalshi.id, 'k1');
});

test('never links one market to more than one market', () => {
  const polymarket = [
    { id: 'p1', title: 'Will Trump win the 2028 US presidential election?' },
    { id: 'p2', title: 'Trump to win the US presidential election in 2028?' },
  ];
  const kalshi = [
    { id: 'k1', title: 'Will Trump win the 2028 United States presidential election?' },
    { id: 'k2', title: 'Will Biden win the 2028 United States presidential election?' },
  ];
  const result = findMatches(polymarket, kalshi, { minimumScore: 0.3 });
  assert.equal(result.links.length, 1);
  assert.equal(new Set(result.links.map((link) => link.kalshi.id)).size, result.links.length);
  assert.equal(new Set(result.links.map((link) => link.polymarket.id)).size, result.links.length);
});

test('does not pair unrelated markets that share only one word', () => {
  const result = findMatches(
    [{ id: 'p1', title: 'Will inflation fall below 2% in 2027?' }],
    [{ id: 'k1', title: 'Will a movie win below deck award?' }],
    { minimumScore: 0.1 },
  );
  assert.equal(result.links.length, 0);
});
