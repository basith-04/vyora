import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createApp } from '../../src/app.js';
import { createAdminAuthorization } from '../../src/middleware/admin-auth.js';
import { createAdminReportingService } from '../../src/services/admin-reporting.js';
import { createAdminRouter } from '../../src/routes/admin.js';
import { DEFAULT_CONFIGURATION } from '../../src/config/constants.js';
import { createTicketService } from '../../src/services/ticket.js';
import { createCheckinService } from '../../src/services/checkin.js';

const projectId = process.env.GCLOUD_PROJECT || 'demo-vyora-26';
let adminApp;
let db;
let auth;
let app;
let testEnvironment;
let ticketService;

const noopServices = {
  checkoutService: { start: async () => ({}), retry: async () => ({}), status: async () => ({}) },
  paymentService: { verifyFromFrontend: async () => ({}) },
  webhookService: { handleWebhook: async () => ({ outcome: 'IGNORED' }) },
};

async function createIdentity(email) {
  const user = await auth.createUser({ email, password: 'Admin-test-password-26!' });
  const endpoint = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`;
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Admin-test-password-26!', returnSecureToken: true }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return { user, token: body.idToken };
}

async function seedReportingData() {
  const now = Timestamp.fromDate(new Date('2026-09-19T10:00:00.000Z'));
  const batch = db.batch();
  batch.set(db.doc('system/capacity'), { eventCapacity: 165, eventOccupied: 2, firstYearCapacity: 55, firstYearOccupied: 1, updatedAt: now });
  for (const [id, workshop] of Object.entries(DEFAULT_CONFIGURATION.workshops)) batch.set(db.doc(`workshops/${id}`), { ...workshop, occupied: id === 'github-ai' ? 2 : 0, createdAt: now, updatedAt: now });
  batch.set(db.doc('registrations/reg-1'), {
    registrationId: 'VYR26-ADMIN-1', fullName: 'Admin, Test', email: 'participant@example.com', phone: '9876543210',
    year: 1, department: 'CSE', class: 'CSE A', ieeeMember: true, ieeeMembershipId: 'IEEE-1', workshopId: 'github-ai',
    isHosteller: false, hostel: null, needsStay: true, stayType: 'NON_AC', baseFee: 399,
    stayFee: 250, totalFee: 649, paymentStatus: 'PAID', registrationStatus: 'CONFIRMED',
    razorpayOrderId: 'order_admin', razorpayPaymentId: 'pay_admin', paymentReconciliationRequired: false,
    capacityReleased: false, recoveryTokenHash: 'must-not-leak', createdAt: now, updatedAt: now, confirmedAt: now,
  });
  batch.set(db.doc('registrations/reg-2'), {
    registrationId: 'VYR26-ADMIN-2', fullName: '@Formula', email: 'second@example.com', phone: '9876543211',
    year: 2, ieeeMember: false, ieeeMembershipId: null, workshopId: 'github-ai',
    isHosteller: true, hostel: 'HOLY_CROSS', needsStay: false, stayType: null, baseFee: 799,
    stayFee: 0, totalFee: 799, paymentStatus: 'PENDING', registrationStatus: 'PAYMENT_PENDING',
    paymentReconciliationRequired: true, capacityReleased: false, recoveryTokenHash: 'must-not-leak',
    seatReservationExpiresAt: Timestamp.fromDate(new Date('2026-09-19T10:05:00.000Z')), createdAt: now, updatedAt: now,
  });
  batch.set(db.doc('payments/pay_admin'), {
    registrationId: 'VYR26-ADMIN-1', razorpayOrderId: 'order_admin', razorpayPaymentId: 'pay_admin',
    amount: 64900, currency: 'INR', status: 'CAPTURED', reconciliationRequired: false, createdAt: now, updatedAt: now,
  });
  await batch.commit();
}

before(async () => {
  assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Auth emulator is required.');
  adminApp = initializeApp({ projectId }, `phase3-admin-${Date.now()}`);
  db = getFirestore(adminApp);
  auth = getAuth(adminApp);
  testEnvironment = await initializeTestEnvironment({ projectId });
  ticketService = createTicketService({
    db,
    getSigningSecret: () => 'phase4-admin-test-ticket-signing-secret-value',
    clock: () => Date.parse('2026-09-19T11:00:00.000Z'),
  });
  app = createApp({
    ...noopServices,
    ticketService,
    adminRouter: createAdminRouter({
      authorizeAdmin: createAdminAuthorization({ auth, db }),
      reportingService: createAdminReportingService({ db }),
      checkinService: createCheckinService({ db, ticketService, clock: () => Date.parse('2026-09-19T11:05:00.000Z') }),
      confirmationEmailService: {
        retryByRegistrationId: async (registrationId) => ({ outcome: 'SENT', registrationId }),
      },
    }),
    logger: { error() {} },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedReportingData();
});

after(async () => {
  await testEnvironment?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

test('Auth identity plus active admins document protects reporting endpoints', async () => {
  const { user, token } = await createIdentity('admin@example.com');
  assert.equal((await request(app).get('/api/admin/registrations').set('Authorization', `Bearer ${token}`)).status, 403);
  await db.doc(`admins/${user.uid}`).set({ name: 'Admin User', email: user.email, role: 'ADMIN', active: false });
  assert.equal((await request(app).get('/api/admin/registrations').set('Authorization', `Bearer ${token}`)).status, 403);
  await db.doc(`admins/${user.uid}`).update({ active: true });

  const profile = await request(app).get('/api/admin/me').set('Authorization', `Bearer ${token}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.role, 'ADMIN');
  const list = await request(app).get('/api/admin/registrations').set('Authorization', `Bearer ${token}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.registrations.length, 2);
  assert.equal(list.body.data.registrations.find((item) => item.registrationId === 'VYR26-ADMIN-1').class, 'CSE A');
  assert.equal(list.body.data.registrations.find((item) => item.registrationId === 'VYR26-ADMIN-2').class, null);
  assert.equal(list.body.data.registrations[0].recoveryTokenHash, undefined);
});

test('active coordinator can read exact dashboard counters, summaries and reconciliation count', async () => {
  const { user, token } = await createIdentity('coordinator@example.com');
  await db.doc(`admins/${user.uid}`).set({ name: 'Coordinator', email: user.email, role: 'COORDINATOR', active: true });
  const response = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.capacity.event, { occupied: 2, capacity: 165 });
  assert.equal(response.body.data.registrations.status.CONFIRMED, 1);
  assert.equal(response.body.data.payments.status.PAID, 1);
  assert.equal(response.body.data.years['1'], 1);
  assert.equal(response.body.data.ieee.member, 1);
  assert.equal(response.body.data.workshops.find((item) => item.id === 'github-ai').occupied, 2);
  assert.equal(response.body.data.accommodation.hostels.HOLY_CROSS, 1);
  assert.equal(response.body.data.payments.reconciliationRequired, 1);
});

test('detail is protected, returns safe data and reports unknown registration', async () => {
  const { user, token } = await createIdentity('detail@example.com');
  await db.doc(`admins/${user.uid}`).set({ name: 'Detail Admin', email: user.email, role: 'ADMIN', active: true });
  assert.equal((await request(app).get('/api/admin/registrations/VYR26-ADMIN-1')).status, 401);
  const detail = await request(app).get('/api/admin/registrations/VYR26-ADMIN-1').set('Authorization', `Bearer ${token}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.payment.amount, 64900);
  assert.equal(detail.body.data.recoveryTokenHash, undefined);
  const missing = await request(app).get('/api/admin/registrations/UNKNOWN').set('Authorization', `Bearer ${token}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'REGISTRATION_NOT_FOUND');
});

test('CSV export requires authorization and neutralizes participant formulas', async () => {
  assert.equal((await request(app).get('/api/admin/export/registrations.csv')).status, 401);
  const { user, token } = await createIdentity('export@example.com');
  await db.doc(`admins/${user.uid}`).set({ name: 'Export Admin', email: user.email, role: 'ADMIN', active: true });
  const response = await request(app).get('/api/admin/export/registrations.csv').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/csv/);
  assert.match(response.headers['content-disposition'], /attachment/);
  assert.match(response.text, /"registrationId","fullName"/);
  assert.match(response.text, /"year","department","class","ieeeMember"/);
  assert.match(response.text, /"CSE","CSE A"/);
  assert.match(response.text, /"'@Formula"/);
  assert.match(response.text, /"Admin, Test"/);
});

test('check-in API requires staff authorization and ignores no client-supplied staff identity', async () => {
  const registrationRef = db.doc('registrations/reg-1');
  const issued = await ticketService.issueForRegistrationRef(registrationRef);
  assert.equal((await request(app).post('/api/admin/check-ins').send({ ticketToken: issued.ticketPayload, type: 'EVENT' })).status, 401);

  const { user, token } = await createIdentity('checkin@example.com');
  await db.doc(`admins/${user.uid}`).set({ name: 'Entrance Staff', email: user.email, role: 'COORDINATOR', active: true });
  const spoof = await request(app).post('/api/admin/check-ins').set('Authorization', `Bearer ${token}`).send({
    ticketToken: issued.ticketPayload, type: 'EVENT', checkedInBy: 'spoofed-uid',
  });
  assert.equal(spoof.status, 400);
  assert.equal(spoof.body.error.code, 'INVALID_CHECKIN_REQUEST');

  const valid = await request(app).post('/api/admin/check-ins').set('Authorization', `Bearer ${token}`).send({
    ticketToken: issued.ticketPayload, type: 'EVENT',
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.data.outcome, 'CHECKED_IN');
  const stored = (await db.collection('checkins').limit(1).get()).docs[0].data();
  assert.equal(stored.checkedInBy, user.uid);
});

test('confirmation email retry endpoint requires an active staff identity', async () => {
  const path = '/api/admin/registrations/VYR26-ADMIN-1/confirmation-email/retry';
  assert.equal((await request(app).post(path)).status, 401);
  const { user, token } = await createIdentity('email-retry@example.com');
  await db.doc(`admins/${user.uid}`).set({ name: 'Email Staff', email: user.email, role: 'COORDINATOR', active: true });
  const response = await request(app).post(path).set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { outcome: 'SENT', registrationId: 'VYR26-ADMIN-1' });
});
