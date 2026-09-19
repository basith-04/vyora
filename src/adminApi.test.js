import test from 'node:test';
import assert from 'node:assert/strict';
import { adminRequest, AdminApiError } from './adminApi.js';

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
