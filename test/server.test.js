import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPolymarket } from '../server.js';

test('paginates Polymarket with the supported keyset cursor', async (t) => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const secondPage = requested.length === 2;
    return new Response(JSON.stringify({
      markets: [{ id: secondPage ? 'p2' : 'p1', question: secondPage ? 'Second market' : 'First market' }],
      next_cursor: secondPage ? '' : 'opaque cursor'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const markets = await fetchPolymarket();

  assert.deepEqual(markets.map((market) => market.id), ['p1', 'p2']);
  assert.match(requested[0], /\/markets\/keyset\?/);
  assert.doesNotMatch(requested[0], /after_cursor/);
  assert.equal(new URL(requested[1]).searchParams.get('after_cursor'), 'opaque cursor');
});
