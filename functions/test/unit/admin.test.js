import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createAdminAuthorization } from '../../src/middleware/admin-auth.js';
import { createAdminRouter } from '../../src/routes/admin.js';
import {
  buildDashboard, buildTicketsReport, filterRegistrationsForExport, publicRegistration, registrationsCsv,
} from '../../src/services/admin-reporting.js';

function fakeDb(profile) {
  return { collection: () => ({ doc: () => ({ get: async () => ({ exists: Boolean(profile), data: () => profile }) }) }) };
}

function protectedApp({ tokenResult = { uid: 'staff-1', email: 'staff@example.com' }, profile } = {}) {
  const auth = { verifyIdToken: async (token) => {
    if (token === 'invalid') throw new Error('bad token');
    return tokenResult;
  } };
  const reportingService = {
    dashboard: async () => ({ ok: true }), registrations: async () => [],
    registration: async () => ({ registrationId: 'VYR26-1' }), csv: async () => '"registrationId"',
    tickets: async () => ({ total: 0, tickets: [] }),
  };
  const app = express();
  app.use('/api/admin', createAdminRouter({
    authorizeAdmin: createAdminAuthorization({ auth, db: fakeDb(profile) }), reportingService,
  }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: { code: error.code } }));
  return app;
}

test('admin authorization rejects missing, malformed, invalid, absent and inactive identities', async () => {
  assert.equal((await request(protectedApp()).get('/api/admin/me')).status, 401);
  assert.equal((await request(protectedApp()).get('/api/admin/me').set('Authorization', 'Token nope')).body.error.code, 'ADMIN_AUTH_REQUIRED');
  assert.equal((await request(protectedApp()).get('/api/admin/me').set('Authorization', 'Bearer invalid')).body.error.code, 'ADMIN_TOKEN_INVALID');
  assert.equal((await request(protectedApp()).get('/api/admin/me').set('Authorization', 'Bearer valid')).status, 403);
  assert.equal((await request(protectedApp({ profile: { role: 'ADMIN', active: false } })).get('/api/admin/me').set('Authorization', 'Bearer valid')).status, 403);
});

for (const role of ['ADMIN', 'COORDINATOR']) {
  test(`active ${role} can use protected read routes`, async () => {
    const app = protectedApp({ profile: { name: 'Staff', email: 'staff@example.com', role, active: true } });
    const response = await request(app).get('/api/admin/me').set('Authorization', 'Bearer valid');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, { name: 'Staff', email: 'staff@example.com', role });
    assert.equal((await request(app).get('/api/admin/dashboard').set('Authorization', 'Bearer valid')).status, 200);
  });
}

test('Tickets API allows ADMIN and rejects COORDINATOR', async () => {
  for (const [role, expected] of [['ADMIN', 200], ['COORDINATOR', 403]]) {
    const app = protectedApp({ profile: { role, active: true } });
    const response = await request(app).get('/api/admin/tickets').set('Authorization', 'Bearer valid');
    assert.equal(response.status, expected);
    if (role === 'COORDINATOR') assert.equal(response.body.error.code, 'FORBIDDEN');
  }
  assert.equal((await request(protectedApp()).get('/api/admin/tickets')).status, 401);
});

test('Manual Ticket API requires an active ADMIN', async () => {
  let calls = 0;
  const makeApp = (profile) => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', createAdminRouter({
      authorizeAdmin: createAdminAuthorization({
        auth: { verifyIdToken: async () => ({ uid: 'staff-1' }) }, db: fakeDb(profile),
      }),
      reportingService: {},
      manualTicketService: { create: async () => { calls += 1; return { ticketId: 'TKT-1' }; } },
    }));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: { code: error.code } }));
    return app;
  };
  assert.equal((await request(makeApp(null)).post('/api/admin/manual-tickets').send({})).status, 401);
  assert.equal((await request(makeApp({ role: 'COORDINATOR', active: true })).post('/api/admin/manual-tickets').set('Authorization', 'Bearer valid').send({})).status, 403);
  assert.equal(calls, 0);
  const result = await request(makeApp({ role: 'ADMIN', active: true })).post('/api/admin/manual-tickets').set('Authorization', 'Bearer valid').send({});
  assert.equal(result.status, 201);
  assert.equal(result.body.data.ticketId, 'TKT-1');
  assert.equal(calls, 1);
});

test('Transfer Ticket API allows ADMIN and rejects COORDINATOR before calling the service', async () => {
  let reads = 0;
  let writes = 0;
  const makeApp = (profile) => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', createAdminRouter({
      authorizeAdmin: createAdminAuthorization({
        auth: { verifyIdToken: async () => ({ uid: 'staff-1' }) }, db: fakeDb(profile),
      }),
      reportingService: {},
      ticketTransferService: {
        detail: async () => { reads += 1; return { registrationId: 'VYR26-1' }; },
        apply: async () => { writes += 1; return { registrationId: 'VYR26-1' }; },
      },
    }));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: { code: error.code } }));
    return app;
  };
  const path = '/api/admin/transfer-ticket/VYR26-1';
  const coordinatorApp = makeApp({ role: 'COORDINATOR', active: true });
  assert.equal((await request(coordinatorApp).get(path).set('Authorization', 'Bearer valid')).status, 403);
  assert.equal((await request(coordinatorApp).post(path).set('Authorization', 'Bearer valid').send({})).status, 403);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  const adminApp = makeApp({ role: 'ADMIN', active: true });
  assert.equal((await request(adminApp).get(path).set('Authorization', 'Bearer valid')).status, 200);
  assert.equal((await request(adminApp).post(path).set('Authorization', 'Bearer valid').send({})).status, 200);
  assert.equal(reads, 1);
  assert.equal(writes, 1);
});

test('Tickets report counts only active tickets with matching confirmed paid registrations', () => {
  const registrations = [
    { _docId: 'a', registrationId: 'VYR26-A', fullName: 'Alice', year: 1, registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', ticketIssued: true, ticketId: 'TKT-A' },
    { _docId: 'b', registrationId: 'VYR26-B', fullName: 'Bob', year: 4, registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', ticketIssued: true, ticketId: 'TKT-B' },
    { _docId: 'c', registrationId: 'VYR26-C', fullName: 'Expired', year: 2, registrationStatus: 'EXPIRED', paymentStatus: 'PAID', ticketIssued: true, ticketId: 'TKT-C' },
    { _docId: 'd', registrationId: 'VYR26-D', fullName: 'Unpaid', year: 3, registrationStatus: 'CONFIRMED', paymentStatus: 'PENDING', ticketIssued: true, ticketId: 'TKT-D' },
  ];
  const tickets = [
    { registrationDocId: 'a', registrationId: 'VYR26-A', ticketId: 'TKT-A', active: true },
    { registrationDocId: 'b', registrationId: 'VYR26-B', ticketId: 'TKT-B', active: true },
    { registrationDocId: 'c', registrationId: 'VYR26-C', ticketId: 'TKT-C', active: true },
    { registrationDocId: 'd', registrationId: 'VYR26-D', ticketId: 'TKT-D', active: true },
    { registrationDocId: 'missing', registrationId: 'VYR26-X', ticketId: 'TKT-X', active: true },
    { registrationDocId: 'a', registrationId: 'VYR26-A', ticketId: 'TKT-A', active: false },
    { registrationDocId: 'b', registrationId: 'VYR26-B', ticketId: 'TKT-WRONG', active: true },
  ];
  const report = buildTicketsReport(tickets, registrations);
  assert.deepEqual(report, { total: 2, tickets: [
    { ticketId: 'TKT-A', fullName: 'Alice', year: 1 },
    { ticketId: 'TKT-B', fullName: 'Bob', year: 4 },
  ] });
  assert.equal(report.tickets.filter((item) => item.year === 1).length, 1);
  assert.equal(report.tickets.filter((item) => item.year === 2).length, 0);
  assert.equal(report.tickets.filter((item) => item.year === 3).length, 0);
  assert.equal(report.tickets.filter((item) => item.year === 4).length, 1);
});

test('dashboard metrics distinguish operational capacity, registration states and payment attempts', () => {
  const registrations = [
    { registrationId: '1', registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', year: 1, ieeeMember: true, workshopId: 'github-ai', isHosteller: true, hostel: 'PG_HOUSE_NEAR_COLLEGE', needsStay: false },
    { registrationId: '2', registrationStatus: 'PAYMENT_PENDING', paymentStatus: 'PENDING', year: 2, ieeeMember: false, workshopId: 'github-ai', isHosteller: false, needsStay: true, stayType: 'AC' },
    { registrationId: '3', registrationStatus: 'EXPIRED', paymentStatus: 'PENDING', year: 1, ieeeMember: false, workshopId: 'data-science', isHosteller: false, needsStay: true, stayType: 'NON_AC', paymentReconciliationRequired: true },
  ];
  const result = buildDashboard({
    registrations,
    payments: [{ registrationId: '3', status: 'FAILED', reconciliationRequired: true }],
    capacity: { eventOccupied: 2, eventCapacity: 165, firstYearOccupied: 1, firstYearCapacity: 55 },
    workshops: { 'github-ai': { name: 'GitHub × AI', occupied: 2, capacity: 55 }, 'data-science': { occupied: 0, capacity: 55 }, 'ai-ml-data': { occupied: 0, capacity: 55 } },
  });
  assert.equal(result.registrations.active, 2);
  assert.equal(result.registrations.status.EXPIRED, 1);
  assert.equal(result.payments.status.PENDING, 2);
  assert.equal(result.payments.attempts.failed, 1);
  assert.equal(result.payments.reconciliationRequired, 1);
  assert.deepEqual(result.capacity.event, { occupied: 2, capacity: 165 });
  assert.equal(result.workshops.find((item) => item.id === 'github-ai').active, 2);
  assert.equal(result.accommodation.activeAcRequests, 1);
  assert.equal(result.accommodation.activeNonAcRequests, 0);
  assert.equal(result.accommodation.hostels.PG_HOUSE_NEAR_COLLEGE, 1);
});

test('admin registration response omits recovery and order-coordination internals', () => {
  const result = publicRegistration({
    registrationId: 'VYR26-SAFE', fullName: 'Safe Participant', email: 'safe@example.com', phone: '9876543210',
    year: 3, department: 'CSE', class: 'CSE D', ieeeMember: false, workshopId: 'github-ai', isHosteller: false, needsStay: false,
    baseFee: 799, stayFee: 0, totalFee: 799, paymentStatus: 'PENDING', registrationStatus: 'PAYMENT_PENDING',
    recoveryTokenHash: 'secret-hash', orderCreationAttemptId: 'private-attempt',
  });
  assert.equal(result.registrationId, 'VYR26-SAFE');
  assert.equal(result.department, 'CSE');
  assert.equal(result.class, 'CSE D');
  assert.equal(result.recoveryTokenHash, undefined);
  assert.equal(result.orderCreationAttemptId, undefined);
});

test('CSV uses expected columns, escapes values and neutralizes spreadsheet formulas', () => {
  const csv = registrationsCsv([{
    registrationId: 'VYR26-1', fullName: '=HYPERLINK("bad")', email: 'a,b@example.com', phone: '+123',
    year: 1, department: 'ADS', class: 'ADS B', ieeeMember: true, ieeeMembershipId: 'IEEE\n"quoted"', workshopId: 'github-ai',
    isHosteller: true, hostel: 'PG_HOUSE_NEAR_COLLEGE', needsStay: false, stayType: null, baseFee: 399, stayFee: 0,
    totalFee: 399, paymentStatus: 'PENDING', registrationStatus: 'PAYMENT_PENDING',
    razorpayOrderId: null, razorpayPaymentId: null, paymentReconciliationRequired: false,
    createdAt: '2026-09-19T00:00:00.000Z', confirmedAt: null, expiredAt: null,
  }]);
  assert.match(csv, /^"registrationId","fullName"/);
  assert.match(csv, /"year","department","class","ieeeMember"/);
  assert.match(csv, /"ADS","ADS B"/);
  assert.match(csv, /"PG_HOUSE_NEAR_COLLEGE"/);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"a,b@example.com"/);
  assert.match(csv, /"'\+123"/);
  assert.match(csv, /"IEEE\n""quoted"""/);
});

const exportRegistrations = [
  {
    registrationId: 'VYR26-ALPHA', fullName: 'Alpha Participant', email: 'alpha@example.com', phone: '9000000001',
    year: 1, department: 'CSE', class: 'CSE A', ieeeMember: true, workshopId: 'github-ai',
    isHosteller: true, hostel: 'SANJOSE', needsStay: false, stayType: null,
    registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', paymentReconciliationRequired: false,
    attendance: { event: { checkedInAt: '2026-10-09T04:00:00.000Z' }, workshop: null },
  },
  {
    registrationId: 'VYR26-BETA', fullName: 'Beta Participant', email: 'beta@example.com', phone: '9000000002',
    year: 2, department: 'ECE', class: 'ECE', ieeeMember: false, workshopId: 'data-science',
    isHosteller: false, hostel: null, needsStay: true, stayType: 'AC',
    registrationStatus: 'PAYMENT_PENDING', paymentStatus: 'PENDING', paymentReconciliationRequired: true,
    attendance: { event: null, workshop: null },
  },
  {
    registrationId: 'VYR26-GAMMA', fullName: 'Gamma Participant', email: 'gamma@example.com', phone: '9000000003',
    year: 1, department: 'ADS', class: 'ADS A', ieeeMember: false, workshopId: 'data-science',
    isHosteller: false, hostel: null, needsStay: true, stayType: 'NON_AC',
    registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', paymentReconciliationRequired: false,
    attendance: { event: null, workshop: { checkedInAt: '2026-10-09T09:00:00.000Z' } },
  },
];

function exportedIds(filters) {
  return filterRegistrationsForExport(exportRegistrations, filters).map((item) => item.registrationId);
}

test('CSV export with no filters includes every registration', () => {
  assert.deepEqual(exportedIds({}), ['VYR26-ALPHA', 'VYR26-BETA', 'VYR26-GAMMA']);
});

test('CSV export applies one active filter', () => {
  assert.deepEqual(exportedIds({ registrationStatus: 'PAYMENT_PENDING' }), ['VYR26-BETA']);
});

test('CSV export combines multiple active filters', () => {
  assert.deepEqual(exportedIds({ registrationStatus: 'CONFIRMED', year: '1', ieee: 'false' }), ['VYR26-GAMMA']);
});

test('CSV export applies search using dashboard search semantics', () => {
  assert.deepEqual(exportedIds({ search: 'cse a' }), ['VYR26-ALPHA']);
});

test('CSV export combines search and dropdown filters', () => {
  assert.deepEqual(exportedIds({ search: 'example.com', year: '1', stayType: 'NON_AC' }), ['VYR26-GAMMA']);
});

test('CSV export with zero matches produces an empty filtered result', () => {
  const filtered = filterRegistrationsForExport(exportRegistrations, {
    search: 'alpha', registrationStatus: 'PAYMENT_PENDING',
  });
  assert.deepEqual(filtered, []);
  assert.equal(registrationsCsv(filtered).trim().split('\r\n').length, 1);
});

test('ticket email lookup and resend require active ADMIN and return only safe results', async () => {
  let calls = 0;
  const makeApp = (profile) => {
    const app = express(); app.use(express.json());
    app.use('/api/admin', createAdminRouter({
      authorizeAdmin: createAdminAuthorization({ auth: { verifyIdToken: async () => ({ uid: 'admin-1' }) }, db: fakeDb(profile) }),
      confirmationEmailService: {
        resendDetail: async (id, admin) => { calls++; assert.equal(admin.role, 'ADMIN'); return { registrationId: id, fullName: 'Devika', email: 'devika@example.com', ticketId: 'TKT-1' }; },
        resendByRegistrationId: async (id, input, admin) => { calls++; assert.equal(id, 'VYR26-TEST'); assert.deepEqual(input, { requestId: 'request-key' }); assert.equal(admin.uid, 'admin-1'); return { outcome: 'SENT' }; },
      },
    }));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: { code: error.code } }));
    return app;
  };
  const path = '/api/admin/registrations/VYR26-TEST/ticket-email';
  for (const [profile, token, status] of [[null, false, 401], [null, true, 403], [{ role: 'COORDINATOR', active: true }, true, 403], [{ role: 'ADMIN', active: false }, true, 403]]) {
    const app = makeApp(profile);
    for (const method of ['get', 'post']) {
      const req = request(app)[method](method === 'get' ? path : `${path}/resend`);
      if (token) req.set('Authorization', 'Bearer valid');
      assert.equal((await req.send({ requestId: 'request-key' })).status, status);
    }
  }
  assert.equal(calls, 0);
  const app = makeApp({ role: 'ADMIN', active: true });
  const detail = await request(app).get(path).set('Authorization', 'Bearer valid');
  assert.deepEqual(Object.keys(detail.body.data).sort(), ['email', 'fullName', 'registrationId', 'ticketId']);
  const sent = await request(app).post(`${path}/resend`).set('Authorization', 'Bearer valid').send({ requestId: 'request-key' });
  assert.deepEqual(sent.body, { data: { outcome: 'SENT' } });
});
