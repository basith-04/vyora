import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminRequest, AdminApiError, createManualTicket, downloadRegistrationsCsv, reconcilePayment,
  loadTicketTransfer, submitTicketTransfer,
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

test('transfer ticket reads and submits through the protected admin API', async (context) => {
  const input = { requestId: 'key', participant: { fullName: 'New holder' } };
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    calls += 1;
    assert.equal(path, '/api/admin/transfer-ticket/VYR26-TEST');
    assert.equal(options.headers.Authorization, 'Bearer token');
    if (calls === 1) assert.equal(options.method, undefined);
    else {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), input);
    }
    return new Response(JSON.stringify({ data: { registrationId: 'VYR26-TEST' } }), { status: 200 });
  });
  assert.equal((await loadTicketTransfer(auth(), 'VYR26-TEST')).registrationId, 'VYR26-TEST');
  assert.equal((await submitTicketTransfer(auth(), 'VYR26-TEST', input)).registrationId, 'VYR26-TEST');
});

test('ticket email resend sends only selected registration and stable request key', async () => {
  const { loadTicketEmail, resendTicketEmail } = await import('./adminApi.js');
  const original = globalThis.fetch;
  const auth = { currentUser: { getIdToken: async () => 'admin-token' } };
  const paths = [];
  globalThis.fetch = async (path, options) => {
    paths.push(path);
    assert.equal(options.headers.Authorization, 'Bearer admin-token');
    if (options.method === 'POST') assert.deepEqual(JSON.parse(options.body), { requestId: 'same-request' });
    return { ok: true, status: 200, json: async () => ({ data: { outcome: 'SENT' } }) };
  };
  try {
    await loadTicketEmail(auth, 'VYR26-SELECTED');
    assert.deepEqual(await resendTicketEmail(auth, 'VYR26-SELECTED', 'same-request'), { outcome: 'SENT' });
    assert.deepEqual(paths, ['/api/admin/registrations/VYR26-SELECTED/ticket-email', '/api/admin/registrations/VYR26-SELECTED/ticket-email/resend']);
  } finally { globalThis.fetch = original; }
});


test('CSV export passes selected columns alongside active completion filters', async (context) => {
  context.mock.method(globalThis, 'fetch', async (path) => {
    const url = new URL(path, 'https://vyora.example');
    assert.equal(url.pathname, '/api/admin/export/registrations.csv');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      search: 'Devika', workshopId: 'github-ai', gender: 'FEMALE', foodPreference: 'VEG', completionDetails: 'COMPLETED',
      columns: 'fullName,email,phone,foodPreference',
    });
    return new Response('"Name"', { status: 200, headers: { 'Content-Type': 'text/csv' } });
  });
  await downloadRegistrationsCsv(auth(), 'Devika', { workshopId: 'github-ai', gender: 'FEMALE', foodPreference: 'VEG', completionDetails: 'COMPLETED' }, ['fullName', 'email', 'phone', 'foodPreference']);
});

test('check-in deadline bounds hung network and late successful responses are never accepted', async (context) => {
  const { submitCheckin } = await import('./adminApi.js');
  let calls = 0; let signal; let respond;
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    calls++; signal = options.signal;
    return new Promise((resolve) => { respond = resolve; });
  });
  const input = { ticketToken: 'opaque-test-token', type: 'EVENT' };
  await assert.rejects(submitCheckin(auth(), input, { timeoutMs: 10 }), { code: 'CHECKIN_TIMEOUT' });
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
  respond(new Response(JSON.stringify({ data: { outcome: 'CHECKED_IN' } }), { status: 200 }));
});

test('check-in deadline also bounds auth and prevents a delayed request after timeout', async (context) => {
  const { submitCheckin } = await import('./adminApi.js');
  let calls = 0; let releaseToken;
  const session = { currentUser: { getIdToken: () => new Promise((resolve) => { releaseToken = resolve; }) } };
  context.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{}'); });
  await assert.rejects(submitCheckin(session, { ticketToken: 'token', type: 'EVENT' }, { timeoutMs: 10 }), { code: 'CHECKIN_TIMEOUT' });
  releaseToken('late-auth-token');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 0);
});

test('check-in never reports success for network, backend or malformed-response failures and does not auto-retry', async (context) => {
  const { submitCheckin } = await import('./adminApi.js');
  let calls = 0;
  const input = { ticketToken: 'test', type: 'EVENT' };
  context.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('network'); });
  await assert.rejects(submitCheckin(auth(), input), { code: 'NETWORK_ERROR' });
  assert.equal(calls, 1);
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Try again.' } }), { status: 500 }));
  await assert.rejects(submitCheckin(auth(), input), { code: 'INTERNAL_ERROR' });
  for (const body of ['{}', '{"data":{"outcome":"unknown"}}', 'invalid-json']) {
    context.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 200 }));
    await assert.rejects(submitCheckin(auth(), input), { code: 'INVALID_RESPONSE' });
  }
});
