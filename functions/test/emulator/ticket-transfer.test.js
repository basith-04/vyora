import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { DEFAULT_CONFIGURATION } from '../../src/config/constants.js';
import { duplicateLockIds } from '../../src/services/locks.js';
import { createTicketService } from '../../src/services/ticket.js';
import { createTicketTransferService } from '../../src/services/ticket-transfer.js';
import { createConfirmationEmailService } from '../../src/services/confirmation-email.js';
import { createCheckinService } from '../../src/services/checkin.js';

const projectId = process.env.GCLOUD_PROJECT || 'demo-vyora-26';
const now = 1_800_000_000_000;
const admin = { uid: 'admin-transfer', role: 'ADMIN', name: 'Admin' };
const coordinator = { uid: 'coordinator', role: 'COORDINATOR' };
const registrationId = 'VYR26-00000000000000000011';
const oldParticipant = {
  fullName: 'Original Holder', email: 'original@example.com', phone: '9876543210',
  year: 1, department: 'CSE', class: 'CSE B', ieeeMember: true, ieeeMembershipId: 'IEEE-1',
  isHosteller: false, hostel: null, needsStay: false, stayType: null, workshopId: 'github-ai',
};
const nextParticipant = {
  fullName: 'New Holder', email: ' NEW@example.com ', phone: '+91 9876543211',
  year: 2, department: 'ECE', class: 'ECE', ieeeMember: false, ieeeMembershipId: null,
  isHosteller: false, hostel: null, needsStay: true, stayType: 'AC', workshopId: 'data-science',
};
let app; let db; let environment; let tickets; let transfer; let checkins; let deliveries;
const registrationRef = () => db.doc('registrations/transfer-registration');
const ticketRef = () => db.doc('tickets/transfer-registration');
const request = (detail, participant = nextParticipant, extra = {}) => ({
  requestId: 'b59c9ad7-5e08-4a8e-a63c-121cbf425990', expectedUpdatedAt: detail.updatedAt,
  participant, ...extra,
});

before(async () => {
  app = initializeApp({ projectId }, `ticket-transfer-${Date.now()}`);
  db = getFirestore(app);
  environment = await initializeTestEnvironment({ projectId });
});
after(async () => { await environment?.cleanup(); if (app) await deleteApp(app); });
beforeEach(async () => {
  await environment.clearFirestore();
  deliveries = [];
  tickets = createTicketService({ db, getSigningSecret: () => 'ticket-transfer-test-signing-secret-with-entropy', clock: () => now });
  const email = createConfirmationEmailService({
    db, ticketService: tickets, clock: () => now + 1000,
    getPublicBaseUrl: () => 'https://vyora.example',
    provider: { send: async (message) => { deliveries.push(message); return { providerMessageId: `message-${deliveries.length}` }; } },
  });
  transfer = createTicketTransferService({ db, ticketService: tickets, confirmationEmailService: email, clock: () => now });
  checkins = createCheckinService({ db, ticketService: tickets, clock: () => now });
  const timestamp = Timestamp.fromMillis(now - 1000);
  await db.doc('system/capacity').set({ ...DEFAULT_CONFIGURATION.capacity, eventOccupied: 1, firstYearOccupied: 1, updatedAt: timestamp });
  for (const [id, workshop] of Object.entries(DEFAULT_CONFIGURATION.workshops)) {
    await db.doc(`workshops/${id}`).set({ ...workshop, occupied: id === 'github-ai' ? 1 : 0, updatedAt: timestamp });
  }
  await registrationRef().set({
    registrationId, ...oldParticipant, baseFee: 399, stayFee: 0, totalFee: 399,
    razorpayOrderId: 'order_original', razorpayOrderAmount: 39900, razorpayPaymentId: 'pay_original',
    paymentStatus: 'PAID', registrationStatus: 'CONFIRMED', capacityReleased: false,
    ticketIssued: false, ticketId: null, recoveryTokenHash: 'a'.repeat(64), recoveryTokenHashes: ['b'.repeat(64)],
    manualPayments: [{ amountPaise: 1000, reason: 'Earlier adjustment', collectedAt: timestamp, recordedBy: 'older-admin' }],
    confirmationEmail: { status: 'SENT', attempts: 1, sentAt: timestamp, lastAttemptAt: timestamp,
      lastErrorCode: null, providerMessageId: 'old-message', leaseExpiresAt: null },
    createdAt: timestamp, updatedAt: timestamp,
  });
  for (const id of duplicateLockIds(oldParticipant)) {
    await db.doc(`registrationLocks/${id}`).set({ registrationDocId: registrationRef().id, registrationId,
      status: 'ACTIVE', createdAt: timestamp, updatedAt: timestamp });
  }
  await tickets.issueForRegistrationRef(registrationRef());
});

test('transfer preserves identity/payment, moves locks/counters, rotates credentials, and emails new holder once', async () => {
  const oldTicket = await tickets.existingForRegistrationRef(registrationRef());
  const detail = await transfer.detail(registrationId, admin);
  const input = request(detail, nextParticipant, { manualPayment: { amountPaise: 40000, reason: 'IEEE to non-IEEE transfer' } });
  const [first, duplicate] = await Promise.all([transfer.apply(registrationId, input, admin), transfer.apply(registrationId, input, admin)]);
  assert.equal(first.ticketId, detail.ticketId);
  assert.equal(duplicate.ticketId, detail.ticketId);
  assert.equal([first.idempotent, duplicate.idempotent].filter(Boolean).length, 1);
  const registration = (await registrationRef().get()).data();
  const ticket = (await ticketRef().get()).data();
  assert.equal(registration.registrationId, registrationId);
  assert.equal(registration.ticketId, detail.ticketId);
  assert.equal(ticket.ticketId, detail.ticketId);
  assert.equal(ticket.credentialVersion, 1);
  assert.equal(registration.fullName, 'New Holder');
  assert.equal(registration.email, 'new@example.com');
  assert.equal(registration.phone, '9876543211');
  assert.equal(registration.razorpayPaymentId, 'pay_original');
  assert.equal(registration.razorpayOrderAmount, 39900);
  assert.equal(registration.totalFee, 399);
  assert.equal(registration.manualPayments.length, 2);
  assert.equal(registration.manualPayments[1].amountPaise, 40000);
  assert.equal(registration.confirmationEmail.status, 'SENT');
  assert.equal((await db.collection('registrations').get()).size, 1);
  assert.equal((await db.collection('tickets').get()).size, 1);
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
  assert.equal((await db.doc('system/capacity').get()).data().firstYearOccupied, 0);
  assert.equal((await db.doc('workshops/github-ai').get()).data().occupied, 0);
  assert.equal((await db.doc('workshops/data-science').get()).data().occupied, 1);
  for (const id of duplicateLockIds(oldParticipant)) assert.equal((await db.doc(`registrationLocks/${id}`).get()).exists, false);
  for (const id of duplicateLockIds({ email: 'new@example.com', phone: '9876543211' })) {
    assert.equal((await db.doc(`registrationLocks/${id}`).get()).data().registrationDocId, registrationRef().id);
  }
  await assert.rejects(tickets.viewByToken(oldTicket.ticketViewToken), { code: 'TICKET_VIEW_INVALID' });
  await assert.rejects(tickets.findByPayload(oldTicket.ticketPayload), { code: 'INVALID_TICKET' });
  await assert.rejects(tickets.participantTicket(registrationId, 'a'.repeat(64)), { code: 'REGISTRATION_NOT_FOUND' });
  await assert.rejects(tickets.participantTicket(registrationId, 'b'.repeat(64)), { code: 'REGISTRATION_NOT_FOUND' });
  const newTicket = await tickets.existingForRegistrationRef(registrationRef());
  assert.equal((await tickets.viewByToken(newTicket.ticketViewToken)).participant.fullName, 'New Holder');
  assert.equal((await tickets.findByPayload(newTicket.ticketPayload)).data.ticketId, detail.ticketId);
  for (const ticketToken of [oldTicket.ticketPayload, oldTicket.ticketViewToken, 'a'.repeat(64)]) {
    await assert.rejects(checkins.checkIn({ ticketToken, type: 'EVENT' }, coordinator), { code: 'INVALID_TICKET' });
  }
  const newScan = await checkins.checkIn({ ticketToken: newTicket.ticketPayload, type: 'WORKSHOP', workshopId: 'data-science' }, coordinator);
  assert.equal(newScan.outcome, 'CHECKED_IN');
  assert.equal(newScan.participant.fullName, 'New Holder');
  await assert.rejects(checkins.checkIn({ ticketToken: newTicket.ticketPayload, type: 'WORKSHOP', workshopId: 'github-ai' }, coordinator), { code: 'WORKSHOP_MISMATCH' });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].to, 'new@example.com');
  assert.match(deliveries[0].idempotencyKey, /transfer\/1$/);
  assert.equal((await db.collection('auditLogs').get()).size, 1);
});

test('transfer without payment leaves existing manual history intact', async () => {
  const detail = await transfer.detail(registrationId, admin);
  await transfer.apply(registrationId, request(detail), admin);
  assert.equal((await registrationRef().get()).data().manualPayments.length, 1);
});

test('duplicate email, duplicate phone, arbitrary fields, and coordinator are rejected without writes', async () => {
  const detail = await transfer.detail(registrationId, admin);
  const before = (await registrationRef().get()).data();
  for (const [kind, participant] of [
    ['email', { ...nextParticipant, phone: '9876543212' }],
    ['phone', { ...nextParticipant, email: 'else@example.com' }],
  ]) {
    const normalized = kind === 'email' ? { email: 'new@example.com', phone: '9876543219' }
      : { email: 'else@example.com', phone: '9876543211' };
    const id = duplicateLockIds(normalized)[kind === 'email' ? 0 : 1];
    await db.doc(`registrationLocks/${id}`).set({ registrationDocId: 'another-registration', registrationId: 'VYR26-OTHER', status: 'ACTIVE' });
    await assert.rejects(transfer.apply(registrationId, request(detail, participant), admin), { code: 'DUPLICATE_REGISTRATION' });
  }
  await assert.rejects(transfer.apply(registrationId, request(detail, { ...nextParticipant, razorpayPaymentId: 'fake' }), admin), { code: 'INVALID_PARTICIPANT_DATA' });
  await assert.rejects(transfer.apply(registrationId, request(detail, { ...nextParticipant, email: oldParticipant.email }), admin), { code: 'TRANSFER_EMAIL_UNCHANGED' });
  await assert.rejects(transfer.apply(registrationId, request(detail), coordinator), { code: 'FORBIDDEN' });
  await assert.rejects(transfer.detail(registrationId, coordinator), { code: 'FORBIDDEN' });
  assert.deepEqual((await registrationRef().get()).data(), before);
  assert.equal((await ticketRef().get()).data().credentialVersion, undefined);
});

for (const type of ['EVENT', 'WORKSHOP']) test(`${type} check-in prevents transfer without changing state`, async () => {
    const issued = await tickets.existingForRegistrationRef(registrationRef());
    await checkins.checkIn({ ticketToken: issued.ticketPayload, type,
      ...(type === 'WORKSHOP' ? { workshopId: 'github-ai' } : {}) }, coordinator);
    const detail = await transfer.detail(registrationId, admin);
    const before = (await registrationRef().get()).data();
    const ticketBefore = (await ticketRef().get()).data();
    const locksBefore = (await db.collection('registrationLocks').get()).docs.map((document) => [document.id, document.data()]);
    await assert.rejects(transfer.apply(registrationId, request(detail), admin), { code: 'TICKET_ALREADY_CHECKED_IN' });
    assert.deepEqual((await registrationRef().get()).data(), before);
    assert.deepEqual((await ticketRef().get()).data(), ticketBefore);
    assert.deepEqual((await db.collection('registrationLocks').get()).docs.map((document) => [document.id, document.data()]), locksBefore);
    assert.equal(deliveries.length, 0);
});
