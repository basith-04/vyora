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
