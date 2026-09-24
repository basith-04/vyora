import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createManualTicketService } from '../../src/services/manual-ticket.js';
import { createTicketService } from '../../src/services/ticket.js';
import { createRegistrationService } from '../../src/services/registration.js';
import { duplicateLockIds } from '../../src/services/locks.js';
import { DEFAULT_CONFIGURATION } from '../../src/config/constants.js';

let app;
let db;
const admin = { uid: 'admin-one', role: 'ADMIN' };
const participant = {
  fullName: 'Manual Participant', email: ' manual@example.com ', phone: '+91 9876543210',
  year: 1, department: 'CSE', class: 'CSE B', ieeeMember: true, ieeeMembershipId: ' IEEE-1 ',
  isHosteller: false, hostel: null, needsStay: true, stayType: 'AC', workshopId: 'github-ai',
};
const input = { participant, manualAmount: '123.45', idempotencyKey: '12345678-1234-4234-8234-123456789abc' };

before(() => {
  app = initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-vyora-26' }, `manual-ticket-${Date.now()}`);
  db = getFirestore(app);
});
after(async () => { if (app) await deleteApp(app); });
beforeEach(async () => {
  const collections = ['registrations', 'registrationLocks', 'tickets', 'auditLogs', 'payments'];
  for (const name of collections) {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
  const now = Timestamp.now();
  await db.doc('system/capacity').set({ ...DEFAULT_CONFIGURATION.capacity, updatedAt: now });
  await db.doc('system/registration-config').set({ ...DEFAULT_CONFIGURATION.registration, registrationOpen: false, updatedAt: now });
  for (const [id, value] of Object.entries(DEFAULT_CONFIGURATION.workshops)) {
    await db.doc(`workshops/${id}`).set({ ...value, updatedAt: now });
  }
});

function services() {
  const ticketService = createTicketService({ db, getSigningSecret: () => 'a'.repeat(48) });
  let sends = 0;
  const service = createManualTicketService({
    db, ticketService,
    confirmationEmailService: { sendForRegistrationRef: async () => { sends += 1; return { outcome: 'SENT' }; } },
  });
  return { service, sends: () => sends };
}

test('confirmed manual registration uses normal ticket service, locks, counters, and one email call', async () => {
  const { service, sends } = services();
  const result = await service.create(input, admin);
  const registrationSnapshot = (await db.collection('registrations').get()).docs[0];
  const registration = registrationSnapshot.data();
  const ticket = (await db.doc(`tickets/${registrationSnapshot.id}`).get()).data();
  assert.equal(result.ticketId, ticket.ticketId);
  assert.equal(registration.registrationStatus, 'CONFIRMED');
  assert.equal(registration.paymentStatus, 'PAID');
  assert.equal(registration.paymentMethod, 'MANUAL');
  assert.equal(registration.manualPayments[0].amountPaise, 12345);
  assert.equal(registration.totalFee, 699);
  assert.equal(registration.razorpayOrderId, null);
  assert.equal(registration.razorpayPaymentId, null);
  assert.equal((await db.collection('payments').get()).size, 0);
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
  assert.equal((await db.doc('system/capacity').get()).data().firstYearOccupied, 1);
  assert.equal((await db.doc('workshops/github-ai').get()).data().occupied, 1);
  for (const id of duplicateLockIds({ email: 'manual@example.com', phone: '9876543210' })) {
    assert.equal((await db.doc(`registrationLocks/${id}`).get()).data().registrationDocId, registrationSnapshot.id);
  }
  assert.equal(sends(), 1);
  const again = await service.create(input, admin);
  assert.equal(again.ticketId, result.ticketId);
  assert.equal(again.idempotent, true);
  assert.equal((await db.collection('registrations').get()).size, 1);
  assert.equal((await db.collection('tickets').get()).size, 1);
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
});

test('duplicate email and phone conflict with public locks', async () => {
  const service = services().service;
  await service.create(input, admin);
  await assert.rejects(service.create({ ...input, participant: { ...participant, phone: '9876543211' }, idempotencyKey: '22345678-1234-4234-8234-123456789abc' }, admin), { code: 'DUPLICATE_REGISTRATION' });
  await assert.rejects(service.create({ ...input, participant: { ...participant, email: 'other@example.com' }, idempotencyKey: '32345678-1234-4234-8234-123456789abc' }, admin), { code: 'DUPLICATE_REGISTRATION' });
  await db.doc('system/registration-config').update({ registrationOpen: true });
  const publicCreate = createRegistrationService({ db });
  await assert.rejects(publicCreate({ ...participant, email: 'manual@example.com', phone: '9876543212' }, { recoveryTokenHash: 'a'.repeat(64) }), { code: 'DUPLICATE_REGISTRATION' });
});

test('validates amount, participant fields, accommodation, and service role before writing', async () => {
  const service = services().service;
  await assert.rejects(service.create(input, { uid: 'coordinator', role: 'COORDINATOR' }), { code: 'FORBIDDEN' });
  await assert.rejects(service.create({ ...input, manualAmount: '0' }, admin), { code: 'INVALID_MANUAL_AMOUNT' });
  await assert.rejects(service.create({ ...input, manualAmount: '1.234' }, admin), { code: 'INVALID_MANUAL_AMOUNT' });
  await assert.rejects(service.create({ ...input, participant: { ...participant, class: 'ECE' } }, admin), { code: 'INVALID_PARTICIPANT_DATA' });
  await assert.rejects(service.create({ ...input, participant: { ...participant, isHosteller: true, hostel: 'SANJOSE' } }, admin), { code: 'INVALID_ACCOMMODATION_SELECTION' });
  assert.equal((await db.collection('registrations').get()).size, 0);
});
