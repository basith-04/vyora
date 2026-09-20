import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createRegistrationService } from '../../src/services/registration.js';
import { createExpirationService } from '../../src/services/expiration.js';
import { createCheckoutService } from '../../src/services/checkout.js';
import { createPaymentService } from '../../src/services/payment.js';
import { DEFAULT_CONFIGURATION } from '../../src/config/constants.js';
import { createTicketService } from '../../src/services/ticket.js';
import { createConfirmationEmailService } from '../../src/services/confirmation-email.js';

const projectId = process.env.GCLOUD_PROJECT || 'demo-vyora-26';
const recoveryTokenHash = 'a'.repeat(64);
const keySecret = 'razorpay-test-secret';
const creationTime = 1_800_000_000_000;
let adminApp;
let db;
let testEnvironment;

const valid = {
  fullName: 'Payment Participant', email: 'payment@example.com', phone: '9876543210', year: 1,
  department: 'ADS', class: 'ADS A',
  ieeeMember: true, ieeeMembershipId: 'IEEE-123', isHosteller: false, hostel: null,
  needsStay: true, stayType: 'AC', workshopId: 'github-ai',
};

async function seed() {
  const now = Timestamp.fromMillis(creationTime);
  const batch = db.batch();
  batch.set(db.doc('system/capacity'), { ...DEFAULT_CONFIGURATION.capacity, updatedAt: now });
  batch.set(db.doc('system/registration-config'), {
    ...DEFAULT_CONFIGURATION.registration,
    pricing: DEFAULT_CONFIGURATION.registration.pricing,
    updatedAt: now,
  });
  for (const [id, workshop] of Object.entries(DEFAULT_CONFIGURATION.workshops)) {
    batch.set(db.doc(`workshops/${id}`), { ...workshop, createdAt: now, updatedAt: now });
  }
  await batch.commit();
}

function fakeGateway({
  createFailure = false,
  paymentOverrides = {},
  orderOverrides = {},
  orderPayments = [],
} = {}) {
  const orders = new Map();
  let createCalls = 0;
  return {
    get createCalls() { return createCalls; },
    getPublicKeyId: () => 'rzp_test_public',
    async createOrder(input) {
      createCalls += 1;
      if (createFailure) throw new Error('simulated order outage');
      const order = { id: `order_${createCalls}`, status: 'created', ...input };
      orders.set(input.receipt, order);
      return order;
    },
    async findOrderByReceipt(receipt) { return orders.get(receipt) ?? null; },
    async fetchPayment(paymentId) {
      const registration = (await db.collection('registrations').limit(1).get()).docs[0].data();
      return {
        id: paymentId, order_id: registration.razorpayOrderId,
        amount: registration.razorpayOrderAmount, currency: 'INR', status: 'captured', captured: true,
        ...paymentOverrides,
      };
    },
    async fetchOrder(orderId) {
      const registration = (await db.collection('registrations').limit(1).get()).docs[0].data();
      return {
        id: orderId, amount: registration.razorpayOrderAmount, currency: 'INR',
        receipt: registration.registrationId, status: 'paid', ...orderOverrides,
      };
    },
    async fetchPaymentsForOrder() {
      const items = typeof orderPayments === 'function' ? await orderPayments() : orderPayments;
      return { entity: 'collection', count: items.length, items };
    },
  };
}

function signature(orderId, paymentId) {
  return createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
}

async function createReadyRegistration(gateway = fakeGateway()) {
  const createRegistration = createRegistrationService({ db, clock: () => creationTime });
  const expirationService = createExpirationService({ db, clock: () => creationTime });
  const checkout = createCheckoutService({
    db, createRegistration, expirationService, razorpay: gateway,
    clock: () => creationTime, logger: { error() {} },
  });
  const result = await checkout.start(valid, recoveryTokenHash);
  return { result, gateway, expirationService };
}

function paymentService(
  gateway,
  clock = () => creationTime + 60_000,
  ticketService = null,
  confirmationEmailService = null,
) {
  return createPaymentService({
    db, razorpay: gateway, getKeySecret: () => keySecret,
    ticketService, confirmationEmailService, clock, logger: { error() {} },
  });
}

function checkoutWithPaymentRecovery(
  gateway,
  clock,
  ticketService = null,
  confirmationEmailService = null,
) {
  const payments = paymentService(gateway, clock, ticketService, confirmationEmailService);
  return createCheckoutService({
    db,
    createRegistration: createRegistrationService({ db, clock }),
    expirationService: createExpirationService({ db, clock }),
    razorpay: gateway,
    paymentService: payments,
    clock,
    logger: { error() {} },
  });
}

async function verify(service, result, paymentId = 'pay_1') {
  return service.verifyFromFrontend({
    registrationId: result.registrationId,
    razorpayOrderId: result.checkout.orderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: signature(result.checkout.orderId, paymentId),
  }, recoveryTokenHash);
}

before(async () => {
  adminApp = initializeApp({ projectId }, `phase2-tests-${Date.now()}`);
  db = getFirestore(adminApp);
  testEnvironment = await initializeTestEnvironment({ projectId });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seed();
});

after(async () => {
  await testEnvironment?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

test('order creation uses only backend pricing and same-token retry reuses seat and order', async () => {
  const gateway = fakeGateway();
  const { result } = await createReadyRegistration(gateway);
  assert.equal(result.checkout.amount, 69900);
  assert.equal(gateway.createCalls, 1);

  const createRegistration = createRegistrationService({ db, clock: () => creationTime + 1_000 });
  const checkout = createCheckoutService({
    db, createRegistration,
    expirationService: createExpirationService({ db, clock: () => creationTime + 1_000 }),
    razorpay: gateway, clock: () => creationTime + 1_000, logger: { error() {} },
  });
  const retry = await checkout.start(valid, recoveryTokenHash);
  const recovered = await checkout.status(null, recoveryTokenHash);
  assert.equal(retry.checkout.orderId, result.checkout.orderId);
  assert.equal(recovered.registrationId, result.registrationId);
  assert.equal(gateway.createCalls, 1);
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
  assert.equal((await db.collection('registrations').get()).size, 1);
});

test('simultaneous same-token submissions create one reservation and at most one order', async () => {
  const gateway = fakeGateway();
  const checkout = createCheckoutService({
    db,
    createRegistration: createRegistrationService({ db, clock: () => creationTime }),
    expirationService: createExpirationService({ db, clock: () => creationTime }),
    razorpay: gateway,
    clock: () => creationTime,
    logger: { error() {} },
  });
  const results = await Promise.allSettled([
    checkout.start(valid, recoveryTokenHash),
    checkout.start(valid, recoveryTokenHash),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length >= 1, true);
  assert.equal(gateway.createCalls, 1);
  assert.equal((await db.collection('registrations').get()).size, 1);
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
});

test('client amount injection is rejected before order creation', async () => {
  const gateway = fakeGateway();
  const createRegistration = createRegistrationService({ db, clock: () => creationTime });
  const checkout = createCheckoutService({
    db, createRegistration,
    expirationService: createExpirationService({ db, clock: () => creationTime }),
    razorpay: gateway, clock: () => creationTime, logger: { error() {} },
  });
  await assert.rejects(
    checkout.start({ ...valid, totalFee: 1 }, recoveryTokenHash),
    (error) => error.code === 'INVALID_PARTICIPANT_DATA',
  );
  assert.equal(gateway.createCalls, 0);
});

test('new registration is rejected while registration is closed before order creation', async () => {
  const gateway = fakeGateway();
  await db.doc('system/registration-config').update({ registrationOpen: false });
  const checkout = createCheckoutService({
    db,
    createRegistration: createRegistrationService({ db, clock: () => creationTime }),
    expirationService: createExpirationService({ db, clock: () => creationTime }),
    razorpay: gateway,
    clock: () => creationTime,
    logger: { error() {} },
  });

  await assert.rejects(
    checkout.start(valid, recoveryTokenHash),
    (error) => error.code === 'REGISTRATION_CLOSED',
  );
  assert.equal(gateway.createCalls, 0);
  assert.equal((await db.collection('registrations').get()).size, 0);
});

test('existing pending registration cannot retry, resume, or expose Checkout while closed', async () => {
  const gateway = fakeGateway({ orderOverrides: { status: 'created' } });
  const { result } = await createReadyRegistration(gateway);
  await db.doc('system/registration-config').update({ registrationOpen: false });
  const checkout = checkoutWithPaymentRecovery(gateway, () => creationTime + 1_000);

  await assert.rejects(
    checkout.retry(result.registrationId, recoveryTokenHash),
    (error) => error.code === 'REGISTRATION_CLOSED',
  );
  await assert.rejects(
    checkout.status(result.registrationId, recoveryTokenHash),
    (error) => error.code === 'REGISTRATION_CLOSED',
  );
  await assert.rejects(
    checkout.start(valid, 'b'.repeat(64)),
    (error) => error.code === 'REGISTRATION_CLOSED',
  );
  assert.equal(gateway.createCalls, 1);
});

test('order creation re-checks registrationOpen immediately before calling Razorpay', async () => {
  const createRegistration = createRegistrationService({ db, clock: () => creationTime });
  const pending = await createRegistration(valid, { recoveryTokenHash });
  const registrationRef = db.doc(`registrations/${pending.registrationDocId}`);
  await registrationRef.update({ orderCreationStatus: 'FAILED' });

  let createCalls = 0;
  const gateway = {
    getPublicKeyId: () => 'rzp_test_public',
    async findOrderByReceipt() {
      await db.doc('system/registration-config').update({ registrationOpen: false });
      return null;
    },
    async createOrder() {
      createCalls += 1;
      throw new Error('Razorpay must not be called while registration is closed.');
    },
  };
  const checkout = createCheckoutService({
    db,
    createRegistration,
    expirationService: createExpirationService({ db, clock: () => creationTime }),
    razorpay: gateway,
    clock: () => creationTime,
    logger: { error() {} },
  });

  await assert.rejects(
    checkout.retry(pending.registrationId, recoveryTokenHash),
    (error) => error.code === 'REGISTRATION_CLOSED',
  );
  assert.equal(createCalls, 0);
});

test('order creation failure remains bounded by normal idempotent expiration', async () => {
  const gateway = fakeGateway({ createFailure: true });
  const createRegistration = createRegistrationService({ db, clock: () => creationTime });
  const expiration = createExpirationService({ db, clock: () => creationTime + 901_000 });
  const checkout = createCheckoutService({
    db, createRegistration, expirationService: expiration,
    razorpay: gateway, clock: () => creationTime, logger: { error() {} },
  });
  await assert.rejects(checkout.start(valid, recoveryTokenHash), (error) => error.code === 'PAYMENT_ORDER_FAILED');
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
  assert.deepEqual(await expiration.expirePendingReservations(), { examined: 1, expired: 1 });
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 0);
});

test('expired registration cannot open or create another order', async () => {
  const { result, gateway } = await createReadyRegistration();
  const registrationDoc = (await db.collection('registrations').limit(1).get()).docs[0];
  const expiration = createExpirationService({ db, clock: () => creationTime + 901_000 });
  await expiration.expireRegistration(registrationDoc.id);
  const checkout = createCheckoutService({
    db,
    createRegistration: createRegistrationService({ db, clock: () => creationTime + 901_000 }),
    expirationService: expiration,
    razorpay: gateway,
    clock: () => creationTime + 901_000,
    logger: { error() {} },
  });
  await assert.rejects(
    checkout.retry(result.registrationId, recoveryTokenHash),
    (error) => error.code === 'RESERVATION_EXPIRED',
  );
  assert.equal(gateway.createCalls, 1);
});

test('matching PENDING registration with an active reservation resumes the same order and seat', async () => {
  const gateway = fakeGateway({ orderOverrides: { status: 'created' } });
  const { result } = await createReadyRegistration(gateway);
  const checkout = checkoutWithPaymentRecovery(gateway, () => creationTime + 1_000);
  const resumed = await checkout.start(valid, 'b'.repeat(64));
  assert.equal(resumed.registrationId, result.registrationId);
  assert.equal(resumed.checkout.orderId, result.checkout.orderId);
  assert.equal(gateway.createCalls, 1);
  assert.equal((await db.collection('registrations').get()).size, 1);
  const capacity = (await db.doc('system/capacity').get()).data();
  assert.equal(capacity.eventOccupied, 1);
  assert.equal(capacity.firstYearOccupied, 1);
  assert.equal((await db.doc('workshops/github-ai').get()).data().occupied, 1);
});

test('matching expired registration re-reserves the same document for a fresh 15 minutes', async () => {
  const gateway = fakeGateway({ orderOverrides: { status: 'created' } });
  const { result } = await createReadyRegistration(gateway);
  const registration = (await db.collection('registrations').limit(1).get()).docs[0];
  await createExpirationService({ db, clock: () => creationTime + 901_000 }).expireRegistration(registration.id);
  const checkout = checkoutWithPaymentRecovery(gateway, () => creationTime + 902_000);
  const resumed = await checkout.start(valid, 'b'.repeat(64));
  assert.equal(resumed.registrationId, result.registrationId);
  assert.equal(resumed.checkout.orderId, result.checkout.orderId);
  assert.equal(Date.parse(resumed.seatReservationExpiresAt), creationTime + 1_802_000);
  assert.equal((await db.collection('registrations').get()).size, 1);
  const capacity = (await db.doc('system/capacity').get()).data();
  assert.equal(capacity.eventOccupied, 1);
  assert.equal(capacity.firstYearOccupied, 1);
  assert.equal((await db.doc('workshops/github-ai').get()).data().occupied, 1);
});

for (const scenario of [
  { name: 'event', code: 'EVENT_FULL', capacity: { eventOccupied: 165 } },
  { name: 'first-year', code: 'FIRST_YEAR_FULL', capacity: { firstYearOccupied: 55 } },
  { name: 'workshop', code: 'WORKSHOP_FULL', workshop: { occupied: 55 } },
]) {
  test(`matching expired registration is rejected when ${scenario.name} capacity is full`, async () => {
    const gateway = fakeGateway({ orderOverrides: { status: 'created' } });
    await createReadyRegistration(gateway);
    const registration = (await db.collection('registrations').limit(1).get()).docs[0];
    await createExpirationService({ db, clock: () => creationTime + 901_000 }).expireRegistration(registration.id);
    if (scenario.capacity) await db.doc('system/capacity').update(scenario.capacity);
    if (scenario.workshop) await db.doc('workshops/github-ai').update(scenario.workshop);
    const checkout = checkoutWithPaymentRecovery(gateway, () => creationTime + 902_000);
    await assert.rejects(
      checkout.start(valid, 'b'.repeat(64)),
      (error) => error.code === scenario.code,
    );
    assert.equal((await db.collection('registrations').get()).size, 1);
    assert.equal((await registration.ref.get()).data().registrationStatus, 'EXPIRED');
    assert.equal(gateway.createCalls, 1);
  });
}

test('concurrent expired retries re-reserve capacity once and reuse one registration/order', async () => {
  const gateway = fakeGateway({ orderOverrides: { status: 'created' } });
  const { result } = await createReadyRegistration(gateway);
  const registration = (await db.collection('registrations').limit(1).get()).docs[0];
  await createExpirationService({ db, clock: () => creationTime + 901_000 }).expireRegistration(registration.id);
  const checkout = checkoutWithPaymentRecovery(gateway, () => creationTime + 902_000);
  const retries = await Promise.all([
    checkout.start(valid, 'b'.repeat(64)),
    checkout.start(valid, 'c'.repeat(64)),
  ]);
  assert.equal(new Set(retries.map((item) => item.registrationId)).size, 1);
  assert.equal(retries[0].registrationId, result.registrationId);
  assert.equal(gateway.createCalls, 1);
  assert.equal((await db.collection('registrations').get()).size, 1);
  const capacity = (await db.doc('system/capacity').get()).data();
  assert.equal(capacity.eventOccupied, 1);
  assert.equal(capacity.firstYearOccupied, 1);
  assert.equal((await db.doc('workshops/github-ai').get()).data().occupied, 1);
});

test('captured previous payment is recovered without opening Checkout and issues one ticket/email', async () => {
  const captured = [];
  const gateway = fakeGateway({ orderPayments: captured, orderOverrides: { status: 'paid' } });
  const { result } = await createReadyRegistration(gateway);
  captured.push({
    id: 'pay_retry_recovered',
    order_id: result.checkout.orderId,
    amount: result.checkout.amount,
    currency: 'INR',
    status: 'captured',
    captured: true,
  });
  let emailCalls = 0;
  const tickets = createTicketService({
    db,
    getSigningSecret: () => 'retry-recovery-ticket-signing-secret-value',
    clock: () => creationTime + 2_000,
  });
  const email = createConfirmationEmailService({
    db,
    ticketService: tickets,
    provider: { send: async () => { emailCalls += 1; return { providerMessageId: 'email_retry_recovered' }; } },
    getPublicBaseUrl: () => 'https://vyora.example',
    clock: () => creationTime + 2_000,
    logger: { error() {} },
  });
  const checkout = checkoutWithPaymentRecovery(gateway, () => creationTime + 2_000, tickets, email);
  const recovered = await checkout.start(valid, 'b'.repeat(64));
  assert.equal(recovered.registrationId, result.registrationId);
  assert.equal(recovered.registrationStatus, 'CONFIRMED');
  assert.equal(recovered.paymentStatus, 'PAID');
  assert.equal(recovered.checkout, undefined);
  assert.equal(gateway.createCalls, 1);
  assert.equal((await db.collection('tickets').get()).size, 1);
  assert.equal((await db.collection('payments').get()).size, 1);
  assert.equal(emailCalls, 1);
});

test('matching details for an already CONFIRMED registration remain rejected', async () => {
  const gateway = fakeGateway();
  const { result } = await createReadyRegistration(gateway);
  await verify(paymentService(gateway), result, 'pay_confirmed_duplicate');
  const checkout = checkoutWithPaymentRecovery(gateway, () => creationTime + 2_000);
  await assert.rejects(
    checkout.start(valid, 'b'.repeat(64)),
    (error) => error.code === 'DUPLICATE_REGISTRATION',
  );
  assert.equal((await db.collection('registrations').get()).size, 1);
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
});

test('valid verification confirms once without changing capacity', async () => {
  const { result, gateway } = await createReadyRegistration();
  const service = paymentService(gateway);
  const before = (await db.doc('system/capacity').get()).data();
  const first = await verify(service, result);
  const second = await verify(service, result);
  const after = (await db.doc('system/capacity').get()).data();
  assert.equal(first.registrationStatus, 'CONFIRMED');
  assert.equal(second.idempotent, true);
  assert.equal(after.eventOccupied, before.eventOccupied);
  assert.equal(after.firstYearOccupied, before.firstYearOccupied);
  const registration = (await db.collection('registrations').limit(1).get()).docs[0].data();
  assert.equal(registration.paymentStatus, 'PAID');
  assert.equal(registration.registrationStatus, 'CONFIRMED');
  assert.equal((await db.collection('payments').get()).size, 1);
});

test('confirmed payment issues one ticket and one idempotent confirmation email', async () => {
  const { result, gateway } = await createReadyRegistration();
  let emailCalls = 0;
  const tickets = createTicketService({
    db,
    getSigningSecret: () => 'phase4-payment-ticket-signing-secret-value',
    clock: () => creationTime + 60_000,
  });
  const email = createConfirmationEmailService({
    db,
    ticketService: tickets,
    provider: { send: async () => { emailCalls += 1; return { providerMessageId: 'email_payment' }; } },
    getPublicBaseUrl: () => 'https://vyora.example',
    clock: () => creationTime + 60_000,
    logger: { error() {} },
  });
  const service = paymentService(gateway, () => creationTime + 60_000, tickets, email);
  const first = await verify(service, result, 'pay_ticket');
  const second = await verify(service, result, 'pay_ticket');
  assert.equal(first.registrationStatus, 'CONFIRMED');
  assert.equal(first.ticketIssued, true);
  assert.equal(second.ticketIssued, true);
  assert.equal((await db.collection('tickets').get()).size, 1);
  assert.equal((await db.collection('payments').get()).size, 1);
  assert.equal(emailCalls, 1);
  assert.equal((await db.collection('registrations').limit(1).get()).docs[0].data().confirmationEmail.status, 'SENT');
});

test('concurrent frontend and webhook confirmation paths do not duplicate confirmation email', async () => {
  const { result, gateway } = await createReadyRegistration();
  let emailCalls = 0;
  const tickets = createTicketService({
    db,
    getSigningSecret: () => 'phase5-concurrent-ticket-signing-secret-value',
    clock: () => creationTime + 60_000,
  });
  const email = createConfirmationEmailService({
    db,
    ticketService: tickets,
    provider: { send: async () => { emailCalls += 1; return { providerMessageId: 'email_concurrent' }; } },
    getPublicBaseUrl: () => 'https://vyora.example',
    clock: () => creationTime + 60_000,
    logger: { error() {} },
  });
  const service = paymentService(gateway, () => creationTime + 60_000, tickets, email);
  await Promise.all([
    verify(service, result, 'pay_concurrent_email'),
    service.processCapturedWebhook({
      paymentId: 'pay_concurrent_email', orderId: result.checkout.orderId, eventId: 'event_concurrent_email',
    }),
  ]);
  assert.equal(emailCalls, 1);
  assert.equal((await db.collection('tickets').get()).size, 1);
  assert.equal((await db.collection('payments').get()).size, 1);
});

test('ticket issuance failure never rolls back a valid confirmed payment', async () => {
  const { result, gateway } = await createReadyRegistration();
  const service = paymentService(gateway, () => creationTime + 60_000, {
    issueForRegistrationRef: async () => { throw new Error('simulated ticket outage'); },
  });
  const verified = await verify(service, result, 'pay_ticket_outage');
  assert.equal(verified.registrationStatus, 'CONFIRMED');
  assert.equal(verified.ticketIssued, false);
  const registration = (await db.collection('registrations').limit(1).get()).docs[0].data();
  assert.equal(registration.registrationStatus, 'CONFIRMED');
  assert.equal(registration.paymentStatus, 'PAID');
  assert.equal((await db.collection('tickets').get()).size, 0);
});

test('invalid signature, wrong order association, and amount mismatch never confirm', async () => {
  const { result, gateway } = await createReadyRegistration();
  const service = paymentService(gateway);
  await assert.rejects(service.verifyFromFrontend({
    registrationId: result.registrationId, razorpayOrderId: result.checkout.orderId,
    razorpayPaymentId: 'pay_bad', razorpaySignature: '00'.repeat(32),
  }, recoveryTokenHash), (error) => error.code === 'PAYMENT_SIGNATURE_INVALID');
  await assert.rejects(service.verifyFromFrontend({
    registrationId: result.registrationId, razorpayOrderId: 'order_wrong',
    razorpayPaymentId: 'pay_bad', razorpaySignature: signature('order_wrong', 'pay_bad'),
  }, recoveryTokenHash), (error) => error.code === 'PAYMENT_VERIFICATION_FAILED');

  const mismatchService = paymentService(fakeGateway({ paymentOverrides: { amount: 1 } }));
  await assert.rejects(verify(mismatchService, result, 'pay_mismatch'), (error) => error.code === 'PAYMENT_AMOUNT_MISMATCH');
  const registration = (await db.collection('registrations').limit(1).get()).docs[0].data();
  assert.notEqual(registration.registrationStatus, 'CONFIRMED');
});

test('expiration winning before captured payment produces reconciliation without reclaiming a seat', async () => {
  const { result, gateway } = await createReadyRegistration();
  const registrationDoc = (await db.collection('registrations').limit(1).get()).docs[0];
  const expiration = createExpirationService({ db, clock: () => creationTime + 901_000 });
  assert.equal((await expiration.expireRegistration(registrationDoc.id)).outcome, 'EXPIRED');
  const service = paymentService(gateway, () => creationTime + 902_000);
  await assert.rejects(verify(service, result, 'pay_late'), (error) => error.code === 'PAYMENT_REQUIRES_RECONCILIATION');
  const registration = (await registrationDoc.ref.get()).data();
  assert.equal(registration.registrationStatus, 'EXPIRED');
  assert.equal(registration.paymentStatus, 'PAID');
  assert.equal(registration.paymentReconciliationRequired, true);
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 0);
});

test('payment confirmation and expiration race cannot produce conflicting capacity state', async () => {
  const { result, gateway } = await createReadyRegistration();
  const registrationDoc = (await db.collection('registrations').limit(1).get()).docs[0];
  const expiration = createExpirationService({ db, clock: () => creationTime + 901_000 });
  const service = paymentService(gateway, () => creationTime + 901_000);
  await Promise.allSettled([
    expiration.expireRegistration(registrationDoc.id),
    verify(service, result, 'pay_race'),
  ]);
  const registration = (await registrationDoc.ref.get()).data();
  const capacity = (await db.doc('system/capacity').get()).data();
  if (registration.registrationStatus === 'CONFIRMED') {
    assert.equal(registration.capacityReleased, false);
    assert.equal(capacity.eventOccupied, 1);
  } else {
    assert.equal(registration.registrationStatus, 'EXPIRED');
    assert.equal(registration.capacityReleased, true);
    assert.equal(registration.paymentReconciliationRequired, true);
    assert.equal(capacity.eventOccupied, 0);
  }
  assert.ok(capacity.eventOccupied >= 0);
  assert.ok(capacity.firstYearOccupied >= 0);
});

test('duplicate webhook and webhook/frontend ordering are idempotent', async () => {
  const { result, gateway } = await createReadyRegistration();
  const service = paymentService(gateway);
  const first = await service.processCapturedWebhook({
    paymentId: 'pay_webhook', orderId: result.checkout.orderId, eventId: 'event_1',
  });
  const duplicate = await service.processCapturedWebhook({
    paymentId: 'pay_webhook', orderId: result.checkout.orderId, eventId: 'event_1',
  });
  const frontend = await verify(service, result, 'pay_webhook');
  assert.equal(first.outcome, 'CONFIRMED');
  assert.equal(duplicate.idempotent, true);
  assert.equal(frontend.idempotent, true);
  assert.equal((await db.collection('payments').get()).size, 1);
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
});

test('frontend verification followed by webhook is idempotent', async () => {
  const { result, gateway } = await createReadyRegistration();
  const service = paymentService(gateway);
  const frontend = await verify(service, result, 'pay_frontend_first');
  const webhook = await service.processCapturedWebhook({
    paymentId: 'pay_frontend_first', orderId: result.checkout.orderId, eventId: 'event_after',
  });
  assert.equal(frontend.registrationStatus, 'CONFIRMED');
  assert.equal(webhook.idempotent, true);
  assert.equal((await db.collection('payments').get()).size, 1);
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
});
