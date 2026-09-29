import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createTicketService } from '../../src/services/ticket.js';
import { createCheckinService } from '../../src/services/checkin.js';

const projectId = process.env.GCLOUD_PROJECT || 'demo-vyora-26';
const now = 1_800_000_000_000;
const ticketSecret = 'phase4-test-ticket-signing-secret-with-32-characters';
const admin = { uid: 'staff-uid', name: 'Test Coordinator', role: 'COORDINATOR' };
let adminApp;
let db;
let testEnvironment;
let tickets;
let checkins;

async function seedRegistration({
  id = 'confirmed-registration',
  registrationId = 'VYR26-00000000000000000001',
  registrationStatus = 'CONFIRMED',
  paymentStatus = 'PAID',
  workshopId = 'github-ai',
} = {}) {
  const data = {
    registrationId,
    fullName: 'Ticket Participant',
    email: 'ticket@example.com',
    phone: '9876543210',
    year: 2,
    ieeeMember: true,
    ieeeMembershipId: 'IEEE-TICKET',
    workshopId,
    registrationStatus,
    paymentStatus,
    ticketIssued: false,
    ticketId: null,
    recoveryTokenHash: 'a'.repeat(64),
    createdAt: Timestamp.fromMillis(now - 60_000),
    updatedAt: Timestamp.fromMillis(now - 60_000),
  };
  const ref = db.doc(`registrations/${id}`);
  await ref.set(data);
  return ref;
}

before(async () => {
  adminApp = initializeApp({ projectId }, `phase4-ticket-${Date.now()}`);
  db = getFirestore(adminApp);
  testEnvironment = await initializeTestEnvironment({ projectId });
  tickets = createTicketService({
    db,
    getSigningSecret: () => ticketSecret,
    clock: () => now,
    random: () => Buffer.from('00112233445566778899', 'hex'),
  });
  checkins = createCheckinService({ db, ticketService: tickets, clock: () => now + 120_000 });
});

beforeEach(async () => testEnvironment.clearFirestore());

after(async () => {
  await testEnvironment?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

test('pending or unpaid registration cannot obtain a ticket', async () => {
  const pending = await seedRegistration({ registrationStatus: 'PAYMENT_PENDING', paymentStatus: 'PENDING' });
  await assert.rejects(tickets.issueForRegistrationRef(pending), (error) => error.code === 'TICKET_NOT_AVAILABLE');
  assert.equal((await db.collection('tickets').get()).size, 0);
});

test('confirmed registration gets one stable ticket across retries and concurrent issuance', async () => {
  const registration = await seedRegistration();
  const results = await Promise.all([
    tickets.issueForRegistrationRef(registration),
    tickets.issueForRegistrationRef(registration),
    tickets.issueForRegistrationRef(registration),
  ]);
  assert.equal(new Set(results.map((result) => result.ticket.ticketId)).size, 1);
  assert.equal(new Set(results.map((result) => result.ticketPayload)).size, 1);
  assert.equal((await db.collection('tickets').get()).size, 1);
  const storedRegistration = (await registration.get()).data();
  assert.equal(storedRegistration.ticketIssued, true);
  assert.equal(storedRegistration.ticketId, results[0].ticket.ticketId);
  const storedTicket = (await db.doc(`tickets/${registration.id}`).get()).data();
  assert.equal(storedTicket.qrTokenHash.length, 64);
  assert.equal(storedTicket.ticketPayload, undefined);
});

test('participant ticket recovery reuses the same opaque payload and requires recovery ownership', async () => {
  const registration = await seedRegistration();
  const first = await tickets.participantTicket('VYR26-00000000000000000001', 'a'.repeat(64));
  const second = await tickets.participantTicket('VYR26-00000000000000000001', 'a'.repeat(64));
  assert.equal(first.ticketPayload, second.ticketPayload);
  assert.match(first.ticketPayload, /^vyora26:t:[A-Za-z0-9_-]{43}$/);
  assert.equal(first.participant.fullName, 'Ticket Participant');
  await assert.rejects(
    tickets.participantTicket('VYR26-00000000000000000001', 'b'.repeat(64)),
    (error) => error.code === 'REGISTRATION_NOT_FOUND',
  );
  assert.equal((await registration.get()).data().ticketIssued, true);
});

test('valid event scan succeeds once and does not create workshop attendance', async () => {
  const registration = await seedRegistration();
  const issued = await tickets.issueForRegistrationRef(registration);
  const first = await checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, admin);
  const duplicate = await checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, admin);
  assert.equal(first.outcome, 'CHECKED_IN');
  assert.equal(duplicate.outcome, 'ALREADY_CHECKED_IN');
  assert.equal(first.participant.registrationId, 'VYR26-00000000000000000001');
  const stored = (await db.collection('checkins').get()).docs.map((doc) => doc.data());
  assert.equal(stored.length, 1);
  assert.equal(stored[0].type, 'EVENT');
  assert.equal(stored[0].checkedInBy, admin.uid);
  assert.equal(stored[0].workshopId, null);
});

test('concurrent event scans create exactly one check-in', async () => {
  const registration = await seedRegistration();
  const issued = await tickets.issueForRegistrationRef(registration);
  const results = await Promise.all([
    checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, admin),
    checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, { ...admin, uid: 'second-staff', name: 'Second Staff' }),
  ]);
  assert.equal(results.filter((result) => result.outcome === 'CHECKED_IN').length, 1);
  assert.equal(results.filter((result) => result.outcome === 'ALREADY_CHECKED_IN').length, 1);
  assert.equal((await db.collection('checkins').get()).size, 1);
});

test('same QR performs independent event and correct workshop check-ins', async () => {
  const registration = await seedRegistration();
  const issued = await tickets.issueForRegistrationRef(registration);
  const event = await checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, admin);
  const workshop = await checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
  const duplicate = await checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
  assert.equal(event.outcome, 'CHECKED_IN');
  assert.equal(workshop.outcome, 'CHECKED_IN');
  assert.equal(duplicate.outcome, 'ALREADY_CHECKED_IN');
  assert.equal((await db.collection('checkins').get()).size, 2);
});

test('wrong workshop is rejected without creating attendance', async () => {
  const registration = await seedRegistration();
  const issued = await tickets.issueForRegistrationRef(registration);
  await assert.rejects(
    checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'WORKSHOP', workshopId: 'data-science' }, admin),
    (error) => error.code === 'WORKSHOP_MISMATCH'
      && error.details.registeredWorkshopId === 'github-ai',
  );
  assert.equal((await db.collection('checkins').get()).size, 0);
});

test('revoked ticket, unconfirmed registration and random tokens fail', async () => {
  const registration = await seedRegistration();
  const issued = await tickets.issueForRegistrationRef(registration);
  await db.doc(`tickets/${registration.id}`).update({ active: false });
  await assert.rejects(
    checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, admin),
    (error) => error.code === 'TICKET_REVOKED',
  );

  await db.doc(`tickets/${registration.id}`).update({ active: true });
  await registration.update({ registrationStatus: 'EXPIRED' });
  await assert.rejects(
    checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, admin),
    (error) => error.code === 'REGISTRATION_NOT_CONFIRMED',
  );
  await assert.rejects(
    checkins.checkIn({ ticketToken: 'random-not-a-ticket', type: 'EVENT' }, admin),
    (error) => error.code === 'INVALID_TICKET',
  );
  assert.equal((await db.collection('checkins').get()).size, 0);
});

for (const count of [1, 10, 20]) test(`check-in burst: ${count} concurrent different tickets`, async (context) => {
  const loadTickets = createTicketService({ db, getSigningSecret: () => ticketSecret, clock: () => now });
  const refs = await Promise.all(Array.from({ length: count }, (_, index) => seedRegistration({ id: `burst-${index}`, registrationId: `VYR26-${String(index).padStart(20, '0')}` })));
  const issued = await Promise.all(refs.map((ref) => loadTickets.issueForRegistrationRef(ref)));
  const beforeRegistrations = await Promise.all(refs.map(async (ref) => (await ref.get()).data()));
  const measurements = [];
  const started = performance.now();
  const results = await Promise.all(issued.map(async (ticket, index) => {
    let credentialMs = 0;
    const service = createCheckinService({ db, clock: () => now, ticketService: {
      ...loadTickets, findByPayload: async (payload) => {
        const began = performance.now();
        const found = await loadTickets.findByPayload(payload);
        credentialMs = performance.now() - began;
        return found;
      },
    } });
    const began = performance.now();
    const timings = {};
    const result = await service.checkIn({ ticketToken: ticket.ticketPayload, type: 'EVENT' }, { ...admin, uid: `staff-${index % 10}` }, timings);
    assert.equal(timings.transactionAttempts, 1);
    const totalMs = performance.now() - began;
    measurements.push({ totalMs, credentialMs, transactionMs: totalMs - credentialMs });
    return result;
  }));
  const elapsedMs = performance.now() - started;
  assert.equal(results.filter((result) => result.outcome === 'CHECKED_IN').length, count);
  const stored = (await db.collection('checkins').get()).docs.map((doc) => doc.data());
  assert.equal(stored.length, count);
  assert.equal(new Set(stored.map((item) => item.registrationDocId)).size, count);
  for (let index = 0; index < count; index++) assert.deepEqual((await refs[index].get()).data(), beforeRegistrations[index]);
  assert.equal((await db.collection('system').get()).size, 0);
  const percentile = (key, p) => Number(measurements.map((item) => item[key]).sort((a, b) => a - b)[Math.ceil(count * p) - 1].toFixed(1));
  context.diagnostic(JSON.stringify({ count, elapsedMs: Number(elapsedMs.toFixed(1)),
    p50Ms: percentile('totalMs', .5), p95Ms: percentile('totalMs', .95),
    credentialP95Ms: percentile('credentialMs', .95), transactionP95Ms: percentile('transactionMs', .95) }));
});

test('many simultaneous scans of the same ticket succeed once; uncertain-result retry is duplicate safe', async () => {
  const ref = await seedRegistration();
  const issued = await tickets.issueForRegistrationRef(ref);
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, { ...admin, uid: `volunteer-${index}` })));
  assert.equal(results.filter((result) => result.outcome === 'CHECKED_IN').length, 1);
  assert.equal(results.filter((result) => result.outcome === 'ALREADY_CHECKED_IN').length, 9);
  assert.equal((await db.collection('checkins').get()).size, 1);
  const retry = await checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, admin);
  assert.equal(retry.outcome, 'ALREADY_CHECKED_IN');
});

test('malformed, arbitrary identities, view/recovery credentials, and mismatched ticket identity cannot check in', async () => {
  const ref = await seedRegistration();
  const issued = await tickets.issueForRegistrationRef(ref);
  for (const ticketToken of [null, '', 'VYR26-00000000000000000001', issued.ticket.ticketId, issued.ticketViewToken, 'a'.repeat(64), `vyora26:t:${'Z'.repeat(43)}`]) {
    await assert.rejects(checkins.checkIn({ ticketToken, type: 'EVENT' }, admin), { code: 'INVALID_TICKET' });
  }
  await assert.rejects(checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT', registrationId: 'forged' }, admin), { code: 'INVALID_CHECKIN_REQUEST' });
  await assert.rejects(checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, null), { code: 'FORBIDDEN' });
  await db.doc(`tickets/${ref.id}`).update({ registrationDocId: 'another-registration' });
  await assert.rejects(checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, admin), { code: 'INVALID_TICKET' });
  assert.equal((await db.collection('checkins').get()).size, 0);
});

test('credential rotation between lookup and transaction cannot accept the stale QR', async () => {
  const ref = await seedRegistration();
  const issued = await tickets.issueForRegistrationRef(ref);
  const service = createCheckinService({ db, ticketService: { ...tickets, findByPayload: async (payload) => {
    const found = await tickets.findByPayload(payload);
    await found.ref.update({ qrTokenHash: 'b'.repeat(64) });
    return found;
  } } });
  await assert.rejects(service.checkIn({ ticketToken: issued.ticketPayload, type: 'EVENT' }, admin), { code: 'INVALID_TICKET' });
  assert.equal((await db.collection('checkins').get()).size, 0);
});
