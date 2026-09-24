import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminRequest, AdminApiError, createManualTicket, downloadRegistrationsCsv, reconcilePayment,
} from './adminApi.js';

function auth(tokens = ['token']) {
  let calls = 0;
  return {
    currentUser: {
      async getIdToken(forceRefresh) {
        const value = tokens[Math.min(calls, tokens.length - 1)];
        calls += 1;
        return `${value}${forceRefresh ? '-fresh' : ''}`;
      },
    },
    get calls() { return calls; },
  };
}

test('admin API attaches Firebase bearer token and returns protected data', async (context) => {
  const session = auth();
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, '/api/admin/me');
    assert.equal(options.headers.Authorization, 'Bearer token');
    return new Response(JSON.stringify({ data: { role: 'ADMIN' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  assert.deepEqual(await adminRequest(session, '/api/admin/me'), { role: 'ADMIN' });
});

test('expired session forces one token refresh and succeeds', async (context) => {
  const session = auth(['stale', 'renewed']);
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ error: { code: 'ADMIN_TOKEN_INVALID' } }), { status: 401 });
    assert.equal(options.headers.Authorization, 'Bearer renewed-fresh');
    return new Response(JSON.stringify({ data: { registrations: [] } }), { status: 200 });
  });
  assert.deepEqual(await adminRequest(session, '/api/admin/registrations'), { registrations: [] });
  assert.equal(session.calls, 2);
});

test('unauthorized admin and signed-out session surface safe API errors', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { code: 'ADMIN_ACCESS_DENIED', message: 'Not authorized.' } }), { status: 403 }));
  await assert.rejects(adminRequest(auth(), '/api/admin/me'), (error) => error instanceof AdminApiError && error.code === 'ADMIN_ACCESS_DENIED' && error.status === 403);
  await assert.rejects(adminRequest({ currentUser: null }, '/api/admin/me'), (error) => error.code === 'ADMIN_AUTH_REQUIRED');
});

test('CSV export response is returned as a Blob', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('"registrationId"\r\n"VYR26-1"', { status: 200, headers: { 'Content-Type': 'text/csv' } }));
  const result = await adminRequest(auth(), '/api/admin/export/registrations.csv', { responseType: 'blob' });
  assert.equal(await result.text(), '"registrationId"\r\n"VYR26-1"');
});

test('CSV export sends only active dashboard search and filters', async (context) => {
  context.mock.method(globalThis, 'fetch', async (path) => {
    assert.equal(path, '/api/admin/export/registrations.csv?search=Devika&year=1&ieee=false');
    return new Response('"registrationId"', { status: 200, headers: { 'Content-Type': 'text/csv' } });
  });
  await downloadRegistrationsCsv(auth(), '  Devika  ', { year: '1', ieee: 'false', workshopId: '' });
});

test('admin API maps network failures without exposing raw fetch errors', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => { throw new Error('socket details'); });
  await assert.rejects(
    adminRequest(auth(), '/api/admin/check-ins', { method: 'POST' }),
    (error) => error.code === 'NETWORK_ERROR' && error.status === 0 && !error.message.includes('socket'),
  );
});

test('manual reconciliation sends only the registration ID in the protected path', async (context) => {
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, '/api/admin/registrations/VYR26-TEST%2FSAFE/reconcile-payment');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, 'Bearer token');
    return new Response(JSON.stringify({ data: { outcome: 'CONFIRMED' } }), { status: 200 });
  });
  assert.deepEqual(await reconcilePayment(auth(), 'VYR26-TEST/SAFE'), { outcome: 'CONFIRMED' });
});

test('manual ticket sends participant, collected amount, and submission key through the protected API', async (context) => {
  const input = { participant: { fullName: 'Participant' }, manualAmount: '123.45', idempotencyKey: 'key' };
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, '/api/admin/manual-tickets');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer token');
    assert.deepEqual(JSON.parse(options.body), input);
    return new Response(JSON.stringify({ data: { ticketId: 'TKT-1' } }), { status: 201 });
  });
  assert.deepEqual(await createManualTicket(auth(), input), { ticketId: 'TKT-1' });
});
