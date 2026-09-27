import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createCompletionService } from '../../src/services/complete-registration.js';
import { createTicketService } from '../../src/services/ticket.js';
const registrationId = 'VYR26-ABCDEFGHIJKLMNOPQRST';
const input = { registrationId, gender: 'MALE', foodPreference: 'VEG', healthSafetyConcern: true, healthSafetyNote: 'Need assistance' };
let app, db, service, ref;
before(() => { app = initializeApp({ projectId: 'demo-vyora-26' }, 'completion-tests'); db = getFirestore(app); service = createCompletionService({ db }); ref = db.doc('registrations/internal-completion-id'); });
after(async () => { await db.recursiveDelete(db.collection('completionRateLimits')); await ref.delete(); await deleteApp(app); });
beforeEach(async () => { await ref.set({ registrationId, registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', fullName: 'Original', email: 'private@example.com', updatedAt: 'original', paymentMethod: 'MANUAL', ticketIssued: false }); });
test('paid confirmed submission changes exactly the intended fields and is write once', async () => {
  const before = (await ref.get()).data();
  assert.deepEqual(await service.submit(input), { success: true });
  const saved = (await ref.get()).data();
  assert.deepEqual(Object.keys(saved).filter((key) => !Object.hasOwn(before, key)).sort(), ['detailsCompletedAt', 'foodPreference', 'gender', 'healthSafetyConcern', 'healthSafetyNote']);
  for (const [key, value] of Object.entries(before)) assert.deepEqual(saved[key], value);
  assert.deepEqual(await service.submit({ ...input, gender: 'FEMALE', healthSafetyNote: 'changed' }), { success: false, code: 'ALREADY_COMPLETED' });
  assert.deepEqual((await ref.get()).data(), saved);
});
test('unknown and every invalid payment/status combination give the same minimal response', async () => {
  const rejected = { success: false, code: 'REGISTRATION_NOT_FOUND' };
  assert.deepEqual(await service.submit({ ...input, registrationId: 'VYR26-ZZZZZZZZZZZZZZZZZZZZ' }), rejected);
  for (const state of [{ paymentStatus: 'PENDING' }, { registrationStatus: 'PAYMENT_PENDING' }, { registrationStatus: 'PAYMENT_FAILED', paymentStatus: 'FAILED' }, { registrationStatus: 'EXPIRED', paymentStatus: 'PAID' }, { registrationStatus: 'CANCELLED' }, { paymentReconciliationRequired: true }, { cancelledAt: 'cancelled' }]) {
    await ref.set({ registrationId, registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', ...state });
    assert.deepEqual(await service.submit(input), rejected);
    assert.equal((await ref.get()).data().gender, undefined);
  }
});
test('NO discards text; arbitrary protected fields are rejected without writing', async () => {
  const before = (await ref.get()).data();
  await assert.rejects(service.submit({ ...input, paymentStatus: 'PAID', fullName: 'changed' }), { code: 'INVALID_COMPLETION' });
  assert.deepEqual((await ref.get()).data(), before);
  await service.submit({ ...input, healthSafetyConcern: false, healthSafetyNote: 'discard' });
  assert.equal((await ref.get()).data().healthSafetyNote, null);
});
test('concurrent submissions commit only one set of values', async () => {
  const results = await Promise.all([service.submit(input), service.submit({ ...input, gender: 'FEMALE', foodPreference: 'NON_VEG', healthSafetyNote: 'Other' })]);
  assert.equal(results.filter((item) => item.success).length, 1);
  assert.equal(results.filter((item) => item.code === 'ALREADY_COMPLETED').length, 1);
  const saved = (await ref.get()).data();
  assert.equal(saved.healthSafetyNote, saved.gender === 'MALE' ? 'Need assistance' : 'Other');
});
test('preexisting partial completion fields are preserved', async () => {
  await ref.update({ gender: 'FEMALE' });
  assert.deepEqual(await service.submit(input), { success: false, code: 'ALREADY_COMPLETED' });
  assert.equal((await ref.get()).data().gender, 'FEMALE');
});
test('target limiter is persistent, transactional and expires', async () => {
  let now = 100000;
  const limiter = createCompletionService({ db, clock: () => now });
  await db.recursiveDelete(db.collection('completionRateLimits'));
  const results = await Promise.allSettled(Array.from({ length: 11 }, () => limiter.limit(input)));
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 10);
  assert.equal(results.find((item) => item.status === 'rejected').reason.code, 'RATE_LIMITED');
  now += 900001;
  await limiter.limit(input);
});
test('unrelated participant ticket and ticket-view responses exclude health information', async () => {
  await service.submit(input);
  const tickets = createTicketService({ db, getSigningSecret: () => 'a-secure-ticket-signing-secret-of-at-least-32-characters' });
  const tokenHash = 'a'.repeat(64);
  await ref.update({ recoveryTokenHash: tokenHash });
  const issued = await tickets.issueForRegistrationRef(ref);
  const participant = await tickets.participantTicket(registrationId, tokenHash);
  const viewed = await tickets.viewByToken(issued.ticketViewToken);
  for (const result of [participant, viewed]) {
    const text = JSON.stringify(result);
    for (const field of ['healthSafetyNote', 'healthSafetyConcern', 'gender', 'foodPreference', 'Need assistance']) assert.equal(text.includes(field), false);
  }
  await db.doc(`tickets/${ref.id}`).delete();
});

test('many independent registration IDs have independent quotas on a shared network', async () => {
  await db.recursiveDelete(db.collection('completionRateLimits'));
  // No IP is accepted or used: all these calls can originate from one NAT address.
  await Promise.all(Array.from({ length: 100 }, (_, index) => service.limit({
    ...input, registrationId: `VYR26-${String(index).padStart(20, '0')}`,
  })));
  for (let attempt = 0; attempt < 10; attempt++) await service.limit(input);
  await assert.rejects(service.limit({ ...input, registrationId: `  ${registrationId.toLowerCase()}  ` }), { code: 'RATE_LIMITED' });
  await service.limit({ ...input, registrationId: 'VYR26-ZZZZZZZZZZZZZZZZZZZZ' });
  const buckets = await db.collection('completionRateLimits').get();
  for (const bucket of buckets.docs) {
    assert.deepEqual(Object.keys(bucket.data()).sort(), ['count', 'expiresAt']);
    assert.equal(bucket.id.includes(registrationId), false);
  }
});
