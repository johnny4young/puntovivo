import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSaleWorkload,
  parseJsonLine,
  readMainThreadBudget,
} from './check-electron-main-thread.mjs';
import { waitForServer } from './electron-budget-sales-workload.mjs';

const budget = {
  windowMs: 15000,
  maxBlockedPercent: 5,
  maxStallMs: 50,
  maxIpcP99Ms: 10,
  minSales: 10,
};
test('parseJsonLine reads one named line and tolerates noise', () => {
  const stdout = `log line\nPUNTOVIVO_MAIN_THREAD_READY={"serverUrl":"http://127.0.0.1:1"}\nmore\n`;
  assert.deepEqual(parseJsonLine(stdout, 'PUNTOVIVO_MAIN_THREAD_READY'), {
    serverUrl: 'http://127.0.0.1:1',
  });
  assert.equal(parseJsonLine(stdout, 'PUNTOVIVO_MAIN_THREAD_METRICS'), null);
  assert.equal(
    parseJsonLine('PUNTOVIVO_MAIN_THREAD_METRICS={bad', 'PUNTOVIVO_MAIN_THREAD_METRICS'),
    null
  );
});

test('the budget entry must carry every positive limit', () => {
  assert.equal(readMainThreadBudget({ electronMainThread: budget }), budget);
  assert.throws(() => readMainThreadBudget({}), /electronMainThread/);
  assert.throws(
    () => readMainThreadBudget({ electronMainThread: { ...budget, maxIpcP99Ms: 0 } }),
    /electronMainThread/
  );
});

function createFakeServer() {
  const requests = [];
  const respond = data => ({
    ok: true,
    status: 200,
    json: async () => [{ result: { data } }],
  });
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace('/api/trpc/', '');
    requests.push({ path, method: init.method, headers: init.headers, body: init.body });
    switch (path) {
      case 'auth.login':
        return respond({ token: 'token-1' });
      case 'auth.registerDevice':
        return respond({ deviceId: 'device-1' });
      case 'cashSessions.getActive':
        return respond({ id: 'session-1', siteId: 'site-1' });
      case 'products.list':
        return respond({
          items: [
            { id: 'p1', tracksStock: true, stock: 5 },
            { id: 'p2', tracksStock: true, tracksLots: true, stock: 5 },
          ],
        });
      case 'products.getById':
        return respond({
          id: 'p1',
          name: 'Arroz Diana 500g',
          price: 3200,
          taxRate: 0,
          unitAssignments: [{ unitId: 'u1', isBase: true, price: 3200 }],
        });
      default:
        return respond({ ok: true });
    }
  };
  return { requests, fetchImpl };
}

test('the workload signs in, binds device and site, then sells with an envelope', async () => {
  const server = createFakeServer();
  const sale = createSaleWorkload({
    serverUrl: 'http://127.0.0.1:9',
    fetchImpl: server.fetchImpl,
    thinkMs: 0,
  });
  await sale.warmUp();
  assert.deepEqual(
    server.requests.map(request => request.path),
    [
      'auth.login',
      'auth.registerDevice',
      'cashSessions.getActive',
      'products.list',
      'products.getById',
    ]
  );

  let rounds = 0;
  const result = await sale.run(() => rounds++ >= 2);
  assert.equal(result.salesInWindow, 2);
  assert.equal(result.failures, 0);

  const create = server.requests.find(request => request.path === 'sales.create');
  assert.equal(create.method, 'POST');
  assert.equal(create.headers.authorization, 'Bearer token-1');
  assert.equal(create.headers['x-device-id'], 'device-1');
  assert.equal(create.headers['x-site-id'], 'site-1');
  const envelope = JSON.parse(create.headers['x-puntovivo-envelope']);
  assert.match(envelope.operationId, /^[0-9a-f-]{36}$/);
  const input = JSON.parse(create.body)[0];
  assert.deepEqual(input.items[0], {
    productId: 'p1',
    unitId: 'u1',
    quantity: 1,
    unitPrice: 3200,
    discount: 0,
    taxRate: 0,
  });
  assert.deepEqual(input.payments, [{ method: 'cash', amount: 3200 }]);
});

test('the workload fails fast when the fixture cashier has no open session', async () => {
  const server = createFakeServer();
  const fetchImpl = async (url, init) =>
    url.includes('cashSessions.getActive')
      ? { ok: true, status: 200, json: async () => [{ result: { data: null } }] }
      : server.fetchImpl(url, init);
  await assert.rejects(
    createSaleWorkload({ serverUrl: 'http://127.0.0.1:9', fetchImpl }).warmUp(),
    /no open cash session/
  );
});

test('the sales workload waits for the embedded server before signing in', async () => {
  let calls = 0;
  await waitForServer('http://127.0.0.1:1', {
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new Error('ECONNREFUSED');
      return { ok: true };
    },
  });
  assert.equal(calls, 3);
  await assert.rejects(
    waitForServer('http://127.0.0.1:1', {
      timeoutMs: 0,
      fetchImpl: async () => ({ ok: false }),
    }),
    /never answered/
  );
});
