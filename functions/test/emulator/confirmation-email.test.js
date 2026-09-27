import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createTicketService } from '../../src/services/ticket.js';
import { createConfirmationEmailService } from '../../src/services/confirmation-email.js';

const projectId = process.env.GCLOUD_PROJECT || 'demo-vyora-26';
const now = 1_800_000_000_000;
let adminApp;
let db;
let testEnvironment;
let ticketService;

async function seedConfirmed() {
  const ref = db.doc('registrations/phase5-registration');
  await ref.set({
    registrationId: 'VYR26-00000000000000000005',
    fullName: 'Email Participant',
    email: 'email-participant@example.com',
    phone: '9876543210', year: 2, ieeeMember: false, ieeeMembershipId: null,
    isHosteller: false, hostel: null, needsStay: false, stayType: null,
    workshopId: 'data-science', paymentStatus: 'PAID', registrationStatus: 'CONFIRMED',
    ticketIssued: false, ticketId: null,
    confirmationEmail: {
      status: 'PENDING', attempts: 0, sentAt: null, lastAttemptAt: null,
      lastErrorCode: null, providerMessageId: null, leaseExpiresAt: null,
    },
    createdAt: Timestamp.fromMillis(now - 60_000), updatedAt: Timestamp.fromMillis(now),
  });
  return ref;
}

before(async () => {
  adminApp = initializeApp({ projectId }, `phase5-email-${Date.now()}`);
  db = getFirestore(adminApp);
  testEnvironment = await initializeTestEnvironment({ projectId });
  ticketService = createTicketService({
    db,
    getSigningSecret: () => 'phase5-emulator-ticket-signing-secret-value',
    clock: () => now,
  });
});

beforeEach(async () => testEnvironment.clearFirestore());

after(async () => {
  await testEnvironment?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

test('email failure preserves confirmed payment and stable ticket, then protected retry succeeds', async () => {
  const ref = await seedConfirmed();
  const issued = await ticketService.issueForRegistrationRef(ref);
  let fail = true;
  let calls = 0;
  const email = createConfirmationEmailService({
    db,
    ticketService,
    provider: { send: async () => {
      calls += 1;
      if (fail) throw Object.assign(new Error('provider unavailable'), { code: 'EMAIL_PROVIDER_UNAVAILABLE' });
      return { providerMessageId: 'email_retry_success' };
    } },
    getPublicBaseUrl: () => 'https://vyora.example',
    clock: () => now + calls * 1_000,
    logger: { error() {} },
  });

  const failed = await email.sendForRegistrationRef(ref, issued);
  assert.equal(failed.outcome, 'FAILED');
  let registration = (await ref.get()).data();
  assert.equal(registration.registrationStatus, 'CONFIRMED');
  assert.equal(registration.paymentStatus, 'PAID');
  assert.equal(registration.confirmationEmail.status, 'FAILED');
  assert.equal((await db.collection('tickets').get()).size, 1);
  assert.equal((await db.collection('tickets').doc(ref.id).get()).data().active, true);

  fail = false;
  const retried = await email.retryByRegistrationId(registration.registrationId);
  assert.equal(retried.outcome, 'SENT');
  registration = (await ref.get()).data();
  assert.equal(registration.confirmationEmail.status, 'SENT');
  assert.equal(registration.confirmationEmail.attempts, 2);
  assert.equal(calls, 2);
  const stable = await ticketService.existingForRegistrationRef(ref);
  assert.equal(stable.ticket.ticketId, issued.ticket.ticketId);
  assert.equal(stable.ticketPayload, issued.ticketPayload);
});

test('duplicate delivery after SENT is a no-op and retry count is bounded', async () => {
  const ref = await seedConfirmed();
  const issued = await ticketService.issueForRegistrationRef(ref);
  let calls = 0;
  const successful = createConfirmationEmailService({
    db, ticketService,
    provider: { send: async () => { calls += 1; return { providerMessageId: 'email_once' }; } },
    getPublicBaseUrl: () => 'https://vyora.example', clock: () => now, logger: { error() {} },
  });
  assert.equal((await successful.sendForRegistrationRef(ref, issued)).outcome, 'SENT');
  assert.equal((await successful.sendForRegistrationRef(ref, issued)).outcome, 'SENT');
  assert.equal(calls, 1);

  await ref.update({
    confirmationEmail: {
      status: 'FAILED', attempts: 3, sentAt: null, lastAttemptAt: Timestamp.fromMillis(now),
      lastErrorCode: 'EMAIL_PROVIDER_UNAVAILABLE', providerMessageId: null, leaseExpiresAt: null,
    },
  });
  const limited = await successful.retryByRegistrationId('VYR26-00000000000000000005');
  assert.equal(limited.outcome, 'RETRY_LIMIT_REACHED');
  assert.equal(calls, 1);
});

test('dedicated ticket-view credential exposes the existing ticket only and rejects invalid credentials', async () => {
  const ref = await seedConfirmed();
  const issued = await ticketService.issueForRegistrationRef(ref);
  const viewed = await ticketService.viewByToken(issued.ticketViewToken);
  assert.equal(viewed.ticketId, issued.ticket.ticketId);
  assert.equal(viewed.ticketPayload, issued.ticketPayload);
  assert.equal(viewed.participant.registrationId, 'VYR26-00000000000000000005');
  assert.equal(viewed.participant.email, undefined);
  assert.equal(viewed.registrationStatus, undefined);
  await assert.rejects(
    ticketService.viewByToken(`vyora26:v:${'Z'.repeat(43)}`),
    (error) => error.code === 'TICKET_VIEW_INVALID',
  );
  assert.equal((await ref.get()).data().registrationStatus, 'CONFIRMED');
});

const resendAdmin = { role: 'ADMIN', uid: 'email-admin' };
const requestA = { requestId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' };
const requestB = { requestId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' };
const emailRegistrationId = 'VYR26-00000000000000000005';
function resendService(provider) {
  return createConfirmationEmailService({ db, ticketService, provider,
    getPublicBaseUrl: () => 'https://vyora.example', clock: () => now, logger: { error() {} } });
}

test('explicit resend reuses template, recipient, current ticket and credentials while automatic SENT stays terminal', async () => {
  const ref = await seedConfirmed();
  await ref.update({ manualPayments: [{ amountPaise: 1000, reason: 'original' }], razorpayPaymentId: 'pay_original' });
  const issued = await ticketService.issueForRegistrationRef(ref);
  const messages = [];
  const email = resendService({ send: async (message) => { messages.push(message); return { providerMessageId: 'email_sent' }; } });
  await email.sendForRegistrationRef(ref, issued);
  const registrationBefore = (await ref.get()).data();
  const ticketBefore = (await db.doc(`tickets/${ref.id}`).get()).data();
  assert.deepEqual(await email.resendDetail(emailRegistrationId, resendAdmin), {
    registrationId: emailRegistrationId, fullName: 'Email Participant', email: 'email-participant@example.com', ticketId: ticketBefore.ticketId,
  });
  assert.deepEqual(await email.resendByRegistrationId(emailRegistrationId, requestA, resendAdmin), { outcome: 'SENT' });
  assert.equal(messages.length, 2);
  for (const key of ['to', 'subject', 'html', 'text']) assert.equal(messages[0][key], messages[1][key]);
  assert.notEqual(messages[0].idempotencyKey, messages[1].idempotencyKey);
  assert.equal(messages[1].to, 'email-participant@example.com');
  assert.deepEqual((await ref.get()).data(), registrationBefore);
  assert.deepEqual((await db.doc(`tickets/${ref.id}`).get()).data(), ticketBefore);
  assert.equal((await db.collection('tickets').get()).size, 1);
  await email.sendForRegistrationRef(ref, issued);
  await email.resendByRegistrationId(emailRegistrationId, requestA, resendAdmin);
  assert.equal(messages.length, 2);
  await email.resendByRegistrationId(emailRegistrationId, requestB, resendAdmin);
  assert.equal(messages.length, 3);
  const audit = (await db.doc(`auditLogs/ticket_email_resend_${requestA.requestId}`).get()).data();
  assert.equal(audit.action, 'TICKET_EMAIL_RESEND');
  assert.equal(audit.performedBy, resendAdmin.uid);
  assert.equal(audit.ticketId, ticketBefore.ticketId);
  assert.equal(audit.status, 'SENT');
  assert.ok(audit.createdAt);
  assert.equal(JSON.stringify(audit).includes(issued.ticketViewToken), false);
  assert.equal(JSON.stringify(audit).includes(ticketBefore.viewTokenHash), false);
});

test('resend rejects non-admins, destination overrides, unsupported fields and invalid tickets', async () => {
  const ref = await seedConfirmed();
  await ticketService.issueForRegistrationRef(ref);
  let sends = 0;
  const email = resendService({ send: async () => { sends++; return { providerMessageId: 'sent' }; } });
  await assert.rejects(email.resendDetail(emailRegistrationId, { role: 'COORDINATOR', uid: 'staff' }), { code: 'FORBIDDEN' });
  await assert.rejects(email.resendByRegistrationId(emailRegistrationId, requestA, { role: 'COORDINATOR', uid: 'staff' }), { code: 'FORBIDDEN' });
  for (const extra of [{ email: 'attacker@example.com' }, { to: 'attacker@example.com' }, { ticketId: 'fake' }]) {
    await assert.rejects(email.resendByRegistrationId(emailRegistrationId, { ...requestA, ...extra }, resendAdmin), { code: 'INVALID_EMAIL_RESEND' });
  }
  await db.doc(`tickets/${ref.id}`).update({ active: false });
  await assert.rejects(email.resendByRegistrationId(emailRegistrationId, requestA, resendAdmin), { code: 'TICKET_NOT_AVAILABLE' });
  await db.doc(`tickets/${ref.id}`).update({ active: true });
  await ref.update({ paymentStatus: 'PENDING' });
  await assert.rejects(email.resendByRegistrationId(emailRegistrationId, requestA, resendAdmin), { code: 'TICKET_NOT_AVAILABLE' });
  assert.equal(sends, 0);
});

test('concurrent resend clicks share an audited claim; retries use the same provider key', async () => {
  const ref = await seedConfirmed();
  await ticketService.issueForRegistrationRef(ref);
  let release;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  let sends = 0;
  const email = resendService({ send: async () => { sends++; started(); await blocked; return { providerMessageId: 'sent' }; } });
  const first = email.resendByRegistrationId(emailRegistrationId, requestA, resendAdmin);
  await ready;
  try {
    assert.deepEqual(await email.resendByRegistrationId(emailRegistrationId, requestA, resendAdmin), { outcome: 'IN_PROGRESS' });
    assert.deepEqual(await email.resendByRegistrationId(emailRegistrationId, requestB, resendAdmin), { outcome: 'IN_PROGRESS' });
  } finally { release(); }
  assert.deepEqual(await first, { outcome: 'SENT' });
  await email.resendByRegistrationId(emailRegistrationId, requestA, resendAdmin);
  assert.equal(sends, 1);
});

test('resend failures are safe and retries do not change normal email state', async () => {
  const ref = await seedConfirmed();
  await ticketService.issueForRegistrationRef(ref);
  const before = (await ref.get()).data();
  const keys = [];
  let fail = true;
  const email = resendService({ send: async (message) => {
    keys.push(message.idempotencyKey);
    if (fail) throw new Error('SECRET provider internals');
    return { providerMessageId: 'sent' };
  } });
  assert.deepEqual(await email.resendByRegistrationId(emailRegistrationId, requestA, resendAdmin), { outcome: 'FAILED' });
  fail = false;
  assert.deepEqual(await email.resendByRegistrationId(emailRegistrationId, requestA, resendAdmin), { outcome: 'SENT' });
  assert.equal(keys[0], keys[1]);
  assert.deepEqual((await ref.get()).data(), before);
});
