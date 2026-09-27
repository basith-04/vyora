import { ALL_CSV_COLUMNS } from '../../shared/csv-fields.js';
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
import { createTicketEditService } from '../../src/services/ticket-edit.js';

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
    seatReservationExpiresAt: Timestamp.fromDate(new Date('2026-09-19T10:15:00.000Z')), createdAt: now, updatedAt: now,
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
      manualReconciliationService: {
        reconcile: async (registrationId, adminContext) => ({
          outcome: 'CONFIRMED', registrationId, reconciledBy: adminContext.uid,
        }),
      },
      ticketEditService: createTicketEditService({ db }),
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

test('Tickets API returns only active confirmed paid tickets to ADMIN', async () => {
  const admin = await createIdentity('tickets-admin@example.com');
  const coordinator = await createIdentity('tickets-coordinator@example.com');
  await db.doc(`admins/${admin.user.uid}`).set({ name: 'Admin', role: 'ADMIN', active: true });
  await db.doc(`admins/${coordinator.user.uid}`).set({ name: 'Coordinator', role: 'COORDINATOR', active: true });
  await db.doc('registrations/reg-1').update({ ticketIssued: true, ticketId: 'TKT-ONE' });
  await db.doc('tickets/reg-1').set({ ticketId: 'TKT-ONE', registrationDocId: 'reg-1', registrationId: 'VYR26-ADMIN-1', active: true });
  await db.doc('registrations/reg-2').update({ ticketIssued: true, ticketId: 'TKT-TWO' });
  await db.doc('tickets/reg-2').set({ ticketId: 'TKT-TWO', registrationDocId: 'reg-2', registrationId: 'VYR26-ADMIN-2', active: true });

  const denied = await request(app).get('/api/admin/tickets').set('Authorization', `Bearer ${coordinator.token}`);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'FORBIDDEN');
  const response = await request(app).get('/api/admin/tickets').set('Authorization', `Bearer ${admin.token}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { total: 1, tickets: [{ ticketId: 'TKT-ONE', fullName: 'Admin, Test', year: 1 }] });
});

test('Edit Ticket is ADMIN-only, appends manual payment, preserves Razorpay and counters, and is idempotent', async () => {
  const admin = await createIdentity('edit-admin@example.com');
  const coordinator = await createIdentity('edit-coordinator@example.com');
  await db.doc(`admins/${admin.user.uid}`).set({ name: 'Admin', role: 'ADMIN', active: true });
  await db.doc(`admins/${coordinator.user.uid}`).set({ name: 'Coordinator', role: 'COORDINATOR', active: true });
  await db.doc('registrations/reg-1').update({ ticketIssued: true, ticketId: 'TKT-EDIT' });
  await db.doc('tickets/reg-1').set({ ticketId: 'TKT-EDIT', registrationDocId: 'reg-1', registrationId: 'VYR26-ADMIN-1', active: true });
  const url = '/api/admin/edit-ticket/VYR26-ADMIN-1';
  assert.equal((await request(app).get(url)).status, 401);
  assert.equal((await request(app).post(url).send({})).status, 401);
  assert.equal((await request(app).get(url).set('Authorization', `Bearer ${coordinator.token}`)).status, 403);
  assert.equal((await request(app).post(url).set('Authorization', `Bearer ${coordinator.token}`).send({})).status, 403);
  const initial = await request(app).get(url).set('Authorization', `Bearer ${admin.token}`);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.data.fullName, 'Admin, Test');
  assert.equal(initial.body.data.ticketId, 'TKT-EDIT');
  const body = { requestId: '123e4567-e89b-42d3-a456-426614174000', expectedUpdatedAt: initial.body.data.updatedAt,
    accommodation: { isHosteller: false, hostel: null, needsStay: true, stayType: 'AC' },
    manualPayment: { amountPaise: 5000, reason: 'NON_AC to AC upgrade' } };
  const beforePayment = (await db.doc('payments/pay_admin').get()).data();
  const beforeCapacity = (await db.doc('system/capacity').get()).data();
  const beforeWorkshop = (await db.doc('workshops/github-ai').get()).data();
  const saved = await request(app).post(url).set('Authorization', `Bearer ${admin.token}`).send(body);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.stayType, 'AC');
  assert.equal(saved.body.data.manualPayments.length, 1);
  assert.equal(saved.body.data.manualPayments[0].amountPaise, 5000);
  assert.equal(saved.body.data.manualPayments[0].recordedBy, admin.user.uid);
  assert.equal((await request(app).post(url).set('Authorization', `Bearer ${admin.token}`).send(body)).status, 200);
  const stored = (await db.doc('registrations/reg-1').get()).data();
  assert.equal(stored.manualPayments.length, 1);
  assert.equal(stored.totalFee, 649);
  assert.equal(stored.stayFee, 250);
  assert.equal(stored.razorpayPaymentId, 'pay_admin');
  assert.deepEqual((await db.doc('payments/pay_admin').get()).data(), beforePayment);
  assert.deepEqual((await db.doc('system/capacity').get()).data(), beforeCapacity);
  assert.deepEqual((await db.doc('workshops/github-ai').get()).data(), beforeWorkshop);
  const audit = (await db.doc('auditLogs/ticket_edit_123e4567-e89b-42d3-a456-426614174000').get()).data();
  assert.equal(audit.performedBy, admin.user.uid);
  assert.equal(audit.metadata.previous.stayType, 'NON_AC');
  assert.equal(audit.metadata.next.stayType, 'AC');
  assert.equal(audit.metadata.manualPayment.amountPaise, 5000);
  assert.ok(audit.createdAt);
  const second = await request(app).post(url).set('Authorization', `Bearer ${admin.token}`).send({
    requestId: '123e4567-e89b-42d3-a456-426614174003', expectedUpdatedAt: saved.body.data.updatedAt,
    manualPayment: { amountPaise: 20000, reason: 'Accommodation adjustment' },
  });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.data.manualPayments.map((payment) => payment.amountPaise), [5000, 20000]);
  assert.equal(second.body.data.stayType, 'AC');
  const badAmount = await request(app).post(url).set('Authorization', `Bearer ${admin.token}`).send({
    requestId: '123e4567-e89b-42d3-a456-426614174004', expectedUpdatedAt: second.body.data.updatedAt,
    manualPayment: { amountPaise: 0, reason: 'Invalid' },
  });
  assert.equal(badAmount.status, 400);
  const invalid = await request(app).post(url).set('Authorization', `Bearer ${admin.token}`).send({
    requestId: '123e4567-e89b-42d3-a456-426614174001', expectedUpdatedAt: second.body.data.updatedAt,
    accommodation: { isHosteller: true, hostel: 'SANJOSE', needsStay: true, stayType: 'AC' },
  });
  assert.equal(invalid.status, 400);
  const arbitrary = await request(app).post(url).set('Authorization', `Bearer ${admin.token}`).send({
    requestId: '123e4567-e89b-42d3-a456-426614174002', expectedUpdatedAt: second.body.data.updatedAt,
    registrationStatus: 'CANCELLED',
  });
  assert.equal(arbitrary.status, 400);
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
  const response = await request(app).get('/api/admin/export/registrations.csv?columns=registrationId,fullName,email,phone,year,department,class,ieeeMember').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/csv/);
  assert.match(response.headers['content-disposition'], /attachment/);
  assert.match(response.text, /"Registration ID","Name","Email","Phone","Year","Department","Class","IEEE Member"/);
  assert.match(response.text, /"CSE","CSE A"/);
  assert.match(response.text, /"'@Formula"/);
  assert.match(response.text, /"Admin, Test"/);

  const filtered = await request(app)
    .get('/api/admin/export/registrations.csv?search=participant%40example.com&registrationStatus=CONFIRMED&year=1')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(filtered.status, 200);
  assert.match(filtered.text, /"Admin, Test"/);
  assert.doesNotMatch(filtered.text, /'@Formula/);
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

test('manual payment reconciliation requires an active ADMIN and rejects COORDINATOR', async () => {
  const path = '/api/admin/registrations/VYR26-ADMIN-1/reconcile-payment';
  assert.equal((await request(app).post(path)).status, 401);

  const inactive = await createIdentity('inactive-reconcile@example.com');
  await db.doc(`admins/${inactive.user.uid}`).set({
    name: 'Inactive Admin', email: inactive.user.email, role: 'ADMIN', active: false,
  });
  assert.equal((await request(app).post(path).set('Authorization', `Bearer ${inactive.token}`)).status, 403);

  const coordinator = await createIdentity('coordinator-reconcile@example.com');
  await db.doc(`admins/${coordinator.user.uid}`).set({
    name: 'Coordinator', email: coordinator.user.email, role: 'COORDINATOR', active: true,
  });
  const denied = await request(app).post(path).set('Authorization', `Bearer ${coordinator.token}`);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'FORBIDDEN');

  const administrator = await createIdentity('admin-reconcile@example.com');
  await db.doc(`admins/${administrator.user.uid}`).set({
    name: 'Administrator', email: administrator.user.email, role: 'ADMIN', active: true,
  });
  const allowed = await request(app).post(path).set('Authorization', `Bearer ${administrator.token}`);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.data.outcome, 'CONFIRMED');
  assert.equal(allowed.body.data.reconciledBy, administrator.user.uid);
});


test('CSV export composes completion filters with selected columns across every matching registration', async () => {
  const { user, token } = await createIdentity('selective-export@example.com');
  await db.doc(`admins/${user.uid}`).set({ name: 'Export Staff', email: user.email, role: 'COORDINATOR', active: true });
  const now = Timestamp.fromDate(new Date('2026-09-28T09:00:00.000Z'));
  await db.doc('registrations/reg-1').update({ gender: 'FEMALE', foodPreference: 'VEG', detailsCompletedAt: now,
    healthSafetyConcern: true, healthSafetyNote: 'PRIVATE_MEDICAL' });
  await db.doc('registrations/reg-3').set({ registrationId: 'VYR26-ADMIN-3', fullName: 'Third Person', email: 'third@example.com', phone: '9876543212',
    year: 1, workshopId: 'github-ai', gender: 'FEMALE', foodPreference: 'VEG', detailsCompletedAt: now,
    healthSafetyNote: 'PRIVATE_MEDICAL', createdAt: now });
  const path = '/api/admin/export/registrations.csv?year=1&workshopId=github-ai&gender=FEMALE&foodPreference=VEG&completionDetails=COMPLETED&columns=fullName,email,phone,foodPreference';
  const selected = await request(app).get(path).set('Authorization', `Bearer ${token}`);
  assert.equal(selected.status, 200);
  assert.equal(selected.text.replace(/^\uFEFF/, '').split('\r\n').length, 3);
  assert.match(selected.text, /^\uFEFF"Name","Email","Phone","Food Preference"/);
  assert.match(selected.text, /"Admin, Test"/);
  assert.match(selected.text, /"Third Person"/);
  assert.doesNotMatch(selected.text, /"@Formula"/);
  assert.doesNotMatch(selected.text, /PRIVATE_MEDICAL/);
  const missing = await request(app).get('/api/admin/export/registrations.csv?gender=NOT_PROVIDED&foodPreference=NOT_PROVIDED&completionDetails=NOT_COMPLETED&columns=fullName,gender,foodPreference').set('Authorization', `Bearer ${token}`);
  assert.equal(missing.status, 200);
  assert.match(missing.text, /"'@Formula","",""/);
  assert.doesNotMatch(missing.text, /"Admin, Test"/);
  for (const unsafe of ['healthSafetyNote', 'recoveryTokenHash', 'gender,healthSafetyNote', '']) {
    const result = await request(app).get(`/api/admin/export/registrations.csv?columns=${unsafe}`).set('Authorization', `Bearer ${token}`);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_CSV_COLUMNS');
  }
  const all = await request(app).get(`/api/admin/export/registrations.csv?columns=${ALL_CSV_COLUMNS.join(',')}`).set('Authorization', `Bearer ${token}`);
  assert.equal(all.status, 200);
  assert.doesNotMatch(all.text, /PRIVATE_MEDICAL|healthSafetyNote|recoveryTokenHash/);
  assert.equal((await request(app).get(path)).status, 401);
});
