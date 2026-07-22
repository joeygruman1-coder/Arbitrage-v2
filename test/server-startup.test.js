import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import {
  getRuntimeSnapshot,
  getRetrievalDiagnostics,
  resetRuntimeForTests,
  scanMarkets,
  startServer,
} from '../server.js';

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  resetRuntimeForTests();
});

test('server, health, and webpage stay available when both venues are unreachable', async () => {
  resetRuntimeForTests();
  globalThis.fetch = async () => { throw Object.assign(new Error('offline'), { code: 'ENETUNREACH' }); };
  const server = startServer({ port: 0, scanOnStart: true, scanIntervalMs: 0 });
  await once(server, 'listening');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const port = server.address().port;
  const health = await httpGet(port, '/health');
  const home = await httpGet(port, '/');
  const diagnostics = await httpGet(port, '/api/retrieval-diagnostics');
  assert.equal(health.status, 200);
  assert.equal(home.status, 200);
  assert.match(home.body, /<!doctype html>/i);
  assert.equal(diagnostics.status, 200);
  const payload = JSON.parse(diagnostics.body);
  assert.match(payload.venues.polymarket.error.message, /retrieval failed/i);
  assert.match(payload.venues.kalshi.error.message, /retrieval failed/i);
  await new Promise((resolve) => server.close(resolve));
});

test('a later schema failure does not erase the last successful venue catalog', async () => {
  resetRuntimeForTests();
  let mode = 'success';
  globalThis.fetch = async (url) => {
    const isPoly = String(url).includes('polymarket');
    const payload = mode === 'success'
      ? isPoly
        ? { markets: [{ id: 'p1', question: 'Will A happen?' }] }
        : { markets: [{ ticker: 'k1', title: 'Will A happen?' }], cursor: '' }
      : isPoly
        ? { unexpected: [] }
        : { markets: [{ ticker: 'k1', title: 'Will A happen?' }], cursor: '' };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await scanMarkets();
  assert.equal(getRuntimeSnapshot().counts.polymarket, 1);
  assert.equal(getRuntimeSnapshot().counts.kalshi, 1);
  mode = 'schema-failure';
  await scanMarkets();
  assert.equal(getRuntimeSnapshot().counts.polymarket, 1);
  assert.equal(getRuntimeSnapshot().counts.kalshi, 1);
  assert.match(getRetrievalDiagnostics().polymarket.error.message, /schema error/i);
});
