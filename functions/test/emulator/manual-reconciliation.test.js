import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createManualReconciliationService } from '../../src/services/manual-reconciliation.js';
import { createTicketService } from '../../src/services/ticket.js';
import { createConfirmationEmailService } from '../../src/services/confirmation-email.js';
import { duplicateLockIds } from '../../src/services/locks.js';
import { DEFAULT_CONFIGURATION } from '../../src/config/constants.js';

const projectId = process.env.GCLOUD_PROJECT || 'demo-vyora-26';
const nowMillis = Date.parse('2026-09-20T10:00:00.000Z');
const admin = { uid: 'admin-reconcile', role: 'ADMIN' };
let adminApp;
let db;
let testEnvironment;

const baseRegistration = {
  registrationId: 'VYR26-RECONCILE01',
  fullName: 'Reconciliation Participant',
  email: 'reconcile@example.com',
  phone: '9876543299',
  department: 'CSE',
  class: 'CSE B',
  year: 1,
  ieeeMember: true,
  ieeeMembershipId: 'IEEE-RECON-1',
  workshopId: 'github-ai',
  isHosteller: false,
  hostel: null,
  needsStay: true,
  stayType: 'AC',
  baseFee: 399,
  stayFee: 300,
  totalFee: 699,
  paymentStatus: 'PENDING',
  registrationStatus: 'PAYMENT_PENDING',
  capacityReleased: false,
  paymentReconciliationRequired: false,
  razorpayOrderId: 'order_reconcile',
  razorpayOrderAmount: 69900,
  razorpayOrderCurrency: 'INR',
  razorpayPaymentId: null,
  ticketIssued: false,
  ticketId: null,
  confirmationEmail: {
    status: 'PENDING', attempts: 0, sentAt: null, lastAttemptAt: null,
    lastErrorCode: null, providerMessageId: null, leaseExpiresAt: null,
  },
  createdAt: Timestamp.fromMillis(nowMillis - 1_000_000),
  updatedAt: Timestamp.fromMillis(nowMillis - 1_000_000),
  seatReservationExpiresAt: Timestamp.fromMillis(nowMillis - 100_000),
  paymentCompletedAt: null,
  confirmedAt: null,
  expiredAt: null,
};

function payment(overrides = {}) {
  return {
    id: 'pay_reconcile',
    order_id: 'order_reconcile',
    amount: 69900,
    currency: 'INR',
    status: 'captured',
    captured: true,
    created_at: Math.floor((nowMillis - 30_000) / 1000),
    ...overrides,
  };
}

function gateway({ payments = [payment()], fetchedPayment = null, order = {} } = {}) {
  const items = payments;
  return {
    async fetchOrder(orderId) {
      return {
        id: orderId,
        receipt: baseRegistration.registrationId,
        amount: 69900,
        currency: 'INR',
        status: 'paid',
        ...order,
      };
    },
    async fetchPaymentsForOrder() { return { entity: 'collection', count: items.length, items }; },
    async fetchPayment(paymentId) {
      return fetchedPayment || items.find((item) => item.id === paymentId) || payment({ id: paymentId });
    },
  };
}

async function seedRegistration(overrides = {}, capacityOverrides = {}, workshopOverrides = {}) {
  const registration = { ...baseRegistration, ...overrides };
  const now = Timestamp.fromMillis(nowMillis - 1_000_000);
  const held = registration.capacityReleased !== true;
  const batch = db.batch();
  batch.set(db.doc('system/capacity'), {
    ...DEFAULT_CONFIGURATION.capacity,
    eventOccupied: held ? 1 : 0,
    firstYearOccupied: held && registration.year === 1 ? 1 : 0,
    ...capacityOverrides,
    updatedAt: now,
  });
  for (const [id, workshop] of Object.entries(DEFAULT_CONFIGURATION.workshops)) {
    batch.set(db.doc(`workshops/${id}`), {
      ...workshop,
      occupied: id === registration.workshopId && held ? 1 : 0,
      ...(id === registration.workshopId ? workshopOverrides : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  batch.set(db.doc('registrations/reconcile-doc'), registration);
  if (held) {
    for (const lockId of duplicateLockIds(registration)) {
      batch.set(db.doc(`registrationLocks/${lockId}`), {
        registrationDocId: 'reconcile-doc',
        registrationId: registration.registrationId,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  await batch.commit();
  return db.doc('registrations/reconcile-doc');
}

function services(remote = gateway(), { provider } = {}) {
  const ticketService = createTicketService({
    db,
    getSigningSecret: () => 'manual-reconciliation-ticket-secret-value-26',
    clock: () => nowMillis,
  });
  const confirmationEmailService = createConfirmationEmailService({
    db,
    ticketService,
    provider: provider || { send: async () => ({ providerMessageId: 'email-reconcile' }) },
    getPublicBaseUrl: () => 'https://vyora.example',
    clock: () => nowMillis,
    logger: { error() {} },
  });
  return createManualReconciliationService({
    db,
    razorpay: remote,
    ticketService,
    confirmationEmailService,
    clock: () => nowMillis,
    logger: { error() {} },
  });
}

before(async () => {
  adminApp = initializeApp({ projectId }, `manual-reconciliation-${Date.now()}`);
  db = getFirestore(adminApp);
  testEnvironment = await initializeTestEnvironment({ projectId });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

after(async () => {
  await testEnvironment?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

test('PENDING captured payment confirms its already-held seat without incrementing capacity twice', async () => {
  const ref = await seedRegistration();
  let sends = 0;
  const service = services(gateway(), { provider: { send: async () => { sends += 1; return { providerMessageId: 'email-1' }; } } });
  const first = await service.reconcile(baseRegistration.registrationId, admin);
  const second = await service.reconcile(baseRegistration.registrationId, admin);
  const [registration, capacity, workshop] = await Promise.all([
    ref.get(), db.doc('system/capacity').get(), db.doc('workshops/github-ai').get(),
  ]);
  assert.equal(first.outcome, 'CONFIRMED');
  assert.equal(first.capacityAllocated, false);
  assert.equal(second.outcome, 'ALREADY_CONFIRMED');
  assert.equal(registration.data().paymentStatus, 'PAID');
  assert.equal(registration.data().registrationStatus, 'CONFIRMED');
  assert.equal(capacity.data().eventOccupied, 1);
  assert.equal(capacity.data().firstYearOccupied, 1);
  assert.equal(workshop.data().occupied, 1);
  assert.equal((await db.collection('tickets').get()).size, 1);
  assert.equal((await db.collection('payments').get()).size, 1);
  assert.equal(sends, 1);
});

test('EXPIRED captured payment reallocates event, first-year and workshop capacity', async () => {
  const ref = await seedRegistration({
    registrationStatus: 'EXPIRED', capacityReleased: true,
    expiredAt: Timestamp.fromMillis(nowMillis - 60_000),
  });
  const result = await services().reconcile(baseRegistration.registrationId, admin);
  const [registration, capacity, workshop] = await Promise.all([
    ref.get(), db.doc('system/capacity').get(), db.doc('workshops/github-ai').get(),
  ]);
  assert.equal(result.outcome, 'CONFIRMED');
  assert.equal(result.capacityAllocated, true);
  assert.equal(registration.data().capacityReleased, false);
  assert.equal(registration.data().paymentReconciliationRequired, false);
  assert.equal(registration.data().manuallyReconciledBy, admin.uid);
  assert.equal(capacity.data().eventOccupied, 1);
  assert.equal(capacity.data().firstYearOccupied, 1);
  assert.equal(workshop.data().occupied, 1);
  assert.equal((await db.collection('registrationLocks').get()).size, 2);
});

test('a locally PAID reconciliation-required registration can be authoritatively recovered', async () => {
  const ref = await seedRegistration({
    registrationStatus: 'EXPIRED', paymentStatus: 'PAID', capacityReleased: true,
    paymentReconciliationRequired: true, razorpayPaymentId: 'pay_reconcile',
  });
  await db.doc('payments/pay_reconcile').set({
    registrationDocId: ref.id,
    registrationId: baseRegistration.registrationId,
    razorpayOrderId: 'order_reconcile',
    razorpayPaymentId: 'pay_reconcile',
    amount: 69900,
    currency: 'INR',
    status: 'CAPTURED',
    sources: ['WEBHOOK'],
    webhookEventIds: ['event-late'],
    reconciliationRequired: true,
    reconciliationReason: 'RESERVATION_EXPIRED',
    createdAt: Timestamp.fromMillis(nowMillis - 30_000),
    verifiedAt: Timestamp.fromMillis(nowMillis - 30_000),
    updatedAt: Timestamp.fromMillis(nowMillis - 30_000),
  });
  const result = await services().reconcile(baseRegistration.registrationId, admin);
  const registration = (await ref.get()).data();
  const storedPayment = (await db.doc('payments/pay_reconcile').get()).data();
  assert.equal(result.outcome, 'CONFIRMED');
  assert.equal(registration.registrationStatus, 'CONFIRMED');
  assert.equal(registration.paymentReconciliationRequired, false);
  assert.equal(storedPayment.reconciliationRequired, false);
  assert.deepEqual(storedPayment.sources.sort(), ['ADMIN_RECONCILIATION', 'WEBHOOK']);
});

test('unpaid and authorized-only Razorpay orders are rejected', async () => {
  await seedRegistration();
  await assert.rejects(
    services(gateway({ payments: [] })).reconcile(baseRegistration.registrationId, admin),
    (error) => error.code === 'NO_CAPTURED_PAYMENT',
  );
  await assert.rejects(
    services(gateway({ payments: [payment({ status: 'authorized', captured: false })] })).reconcile(baseRegistration.registrationId, admin),
    (error) => error.code === 'PAYMENT_NOT_CAPTURED',
  );
});

test('wrong order, amount, and currency never confirm a registration', async () => {
  const ref = await seedRegistration();
  await assert.rejects(
    services(gateway({ payments: [payment({ order_id: 'order_wrong' })] })).reconcile(baseRegistration.registrationId, admin),
    (error) => error.code === 'PAYMENT_ORDER_MISMATCH',
  );
  await assert.rejects(
    services(gateway({ payments: [payment({ amount: 1 })] })).reconcile(baseRegistration.registrationId, admin),
    (error) => error.code === 'PAYMENT_AMOUNT_MISMATCH',
  );
  await assert.rejects(
    services(gateway({ payments: [payment({ currency: 'USD' })] })).reconcile(baseRegistration.registrationId, admin),
    (error) => error.code === 'PAYMENT_AMOUNT_MISMATCH',
  );
  assert.equal((await ref.get()).data().registrationStatus, 'PAYMENT_PENDING');
});

test('already-used and ambiguous captured payments are rejected', async () => {
  await seedRegistration();
  await db.doc('payments/pay_reconcile').set({
    registrationId: 'VYR26-OTHER', registrationDocId: 'other', razorpayPaymentId: 'pay_reconcile',
  });
  await assert.rejects(
    services().reconcile(baseRegistration.registrationId, admin),
    (error) => error.code === 'PAYMENT_ALREADY_USED',
  );
  await db.doc('payments/pay_reconcile').delete();
  await assert.rejects(
    services(gateway({ payments: [payment(), payment({ id: 'pay_second' })] })).reconcile(baseRegistration.registrationId, admin),
    (error) => error.code === 'AMBIGUOUS_PAYMENT' && error.details.capturedPaymentCount === 2,
  );
});

for (const scenario of [
  { name: 'event', capacity: { eventCapacity: 1, eventOccupied: 1 }, reason: 'EVENT_FULL' },
  { name: 'first-year', capacity: { firstYearCapacity: 1, firstYearOccupied: 1 }, reason: 'FIRST_YEAR_FULL' },
  { name: 'workshop', workshop: { capacity: 1, occupied: 1 }, reason: 'WORKSHOP_FULL' },
]) {
  test(`captured payment with ${scenario.name} capacity full is recorded but not confirmed`, async () => {
    const ref = await seedRegistration(
      { registrationStatus: 'EXPIRED', capacityReleased: true, paymentReconciliationRequired: true },
      scenario.capacity,
      scenario.workshop,
    );
    const result = await services().reconcile(baseRegistration.registrationId, admin);
    const registration = (await ref.get()).data();
    assert.equal(result.outcome, 'PAYMENT_VERIFIED_NO_CAPACITY');
    assert.equal(result.reason, scenario.reason);
    assert.equal(registration.paymentStatus, 'PAID');
    assert.equal(registration.registrationStatus, 'EXPIRED');
    assert.equal(registration.paymentReconciliationRequired, true);
    assert.equal((await db.collection('tickets').get()).size, 0);
    assert.equal((await db.collection('payments').get()).docs[0].data().reconciliationReason, scenario.reason);
  });
}

test('concurrent reconciliation requests allocate released capacity exactly once', async () => {
  await seedRegistration({ registrationStatus: 'EXPIRED', capacityReleased: true, paymentReconciliationRequired: true });
  const service = services();
  const results = await Promise.all([
    service.reconcile(baseRegistration.registrationId, admin),
    service.reconcile(baseRegistration.registrationId, admin),
  ]);
  const [capacity, workshop] = await Promise.all([
    db.doc('system/capacity').get(), db.doc('workshops/github-ai').get(),
  ]);
  assert.deepEqual(results.map((item) => item.outcome).sort(), ['ALREADY_CONFIRMED', 'CONFIRMED']);
  assert.equal(capacity.data().eventOccupied, 1);
  assert.equal(capacity.data().firstYearOccupied, 1);
  assert.equal(workshop.data().occupied, 1);
  assert.equal((await db.collection('tickets').get()).size, 1);
});

test('already confirmed registration is idempotent and does not allocate again', async () => {
  const ref = await seedRegistration({
    registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', razorpayPaymentId: 'pay_reconcile',
    confirmedAt: Timestamp.fromMillis(nowMillis - 10_000),
  });
  await db.doc('payments/pay_reconcile').set({
    registrationDocId: ref.id,
    registrationId: baseRegistration.registrationId,
    razorpayOrderId: 'order_reconcile',
    razorpayPaymentId: 'pay_reconcile',
    amount: 69900,
    currency: 'INR',
    status: 'CAPTURED',
    sources: ['FRONTEND'],
    webhookEventIds: [],
    reconciliationRequired: false,
    reconciliationReason: null,
    createdAt: Timestamp.fromMillis(nowMillis - 10_000),
    verifiedAt: Timestamp.fromMillis(nowMillis - 10_000),
    updatedAt: Timestamp.fromMillis(nowMillis - 10_000),
  });
  const result = await services().reconcile(baseRegistration.registrationId, admin);
  assert.equal(result.outcome, 'ALREADY_CONFIRMED');
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
  assert.equal((await db.doc('workshops/github-ai').get()).data().occupied, 1);
  assert.equal((await db.collection('tickets').get()).size, 1);
});

test('email failure never rolls back confirmed payment, capacity, or ticket', async () => {
  const ref = await seedRegistration({ registrationStatus: 'EXPIRED', capacityReleased: true });
  const service = services(gateway(), { provider: { send: async () => { throw new Error('simulated outage'); } } });
  const result = await service.reconcile(baseRegistration.registrationId, admin);
  const registration = (await ref.get()).data();
  assert.equal(result.outcome, 'CONFIRMED');
  assert.equal(result.confirmationEmailStatus, 'FAILED');
  assert.equal(registration.paymentStatus, 'PAID');
  assert.equal(registration.registrationStatus, 'CONFIRMED');
  assert.equal(registration.confirmationEmail.status, 'FAILED');
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
  assert.equal((await db.collection('tickets').get()).size, 1);
});

test('service independently requires an ADMIN context', async () => {
  await seedRegistration();
  await assert.rejects(
    services().reconcile(baseRegistration.registrationId, { uid: 'coordinator', role: 'COORDINATOR' }),
    (error) => error.code === 'FORBIDDEN',
  );
});
