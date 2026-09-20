import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createAdminAuthorization } from '../../src/middleware/admin-auth.js';
import { createAdminRouter } from '../../src/routes/admin.js';
import { buildDashboard, publicRegistration, registrationsCsv } from '../../src/services/admin-reporting.js';

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

test('dashboard metrics distinguish operational capacity, registration states and payment attempts', () => {
  const registrations = [
    { registrationId: '1', registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', year: 1, ieeeMember: true, workshopId: 'github-ai', isHosteller: true, hostel: 'SANJOSE', needsStay: false },
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
    isHosteller: false, hostel: null, needsStay: false, stayType: null, baseFee: 399, stayFee: 0,
    totalFee: 399, paymentStatus: 'PENDING', registrationStatus: 'PAYMENT_PENDING',
    razorpayOrderId: null, razorpayPaymentId: null, paymentReconciliationRequired: false,
    createdAt: '2026-09-19T00:00:00.000Z', confirmedAt: null, expiredAt: null,
  }]);
  assert.match(csv, /^"registrationId","fullName"/);
  assert.match(csv, /"year","department","class","ieeeMember"/);
  assert.match(csv, /"ADS","ADS B"/);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"a,b@example.com"/);
  assert.match(csv, /"'\+123"/);
  assert.match(csv, /"IEEE\n""quoted"""/);
});
