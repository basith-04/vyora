import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  accommodation = { isHosteller: false, hostel: null, needsStay: false, stayType: null },
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
    ...accommodation,
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

// Emulator-only historical fixtures, including valid legacy departure/return-only evidence.
async function historicalAttendance(ref, type, workshopId = null) {
  const registration = (await ref.get()).data();
  const id = createHash('sha256').update(`vyora26:checkin:v1:${type}:${workshopId || '-'}:${ref.id}`).digest('hex');
  const checkinRef = db.doc(`checkins/${id}`);
  await checkinRef.set({ registrationDocId: ref.id, registrationId: registration.registrationId, ticketId: registration.ticketId,
    type, workshopId, checkedInAt: Timestamp.fromMillis(now - 86_400_000), checkedInBy: 'historical-staff' });
  return checkinRef.get();
}

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

test('all six checkpoint identities and duplicate protection survive Day 2 prerequisite validation', async () => {
  const ref = await seedRegistration();
  const ticket = await tickets.issueForRegistrationRef(ref);
  const selections = [
    { type: 'EVENT' }, { type: 'DAY1_CHECK_OUT', accommodationGroup: 'ALL' },
    { type: 'WORKSHOP', workshopId: 'github-ai' }, { type: 'FIELD_TRIP_DEPARTURE' },
    { type: 'FIELD_TRIP_RETURN' }, { type: 'DAY2_CHECK_OUT', accommodationGroup: 'ALL' },
  ];
  for (const selection of selections) {
    assert.equal((await checkins.checkIn({ ticketToken: ticket.ticketPayload, ...selection }, admin)).outcome, 'CHECKED_IN');
    assert.equal((await checkins.checkIn({ ticketToken: ticket.ticketPayload, ...selection }, admin)).outcome, 'ALREADY_CHECKED_IN');
  }
  const stored = await db.collection('checkins').get();
  assert.equal(stored.size, 6);
  assert.equal(new Set(stored.docs.map((doc) => doc.id)).size, 6);
  assert.deepEqual(new Set(stored.docs.map((doc) => doc.data().type)), new Set(selections.map((item) => item.type)));
  const race = await Promise.all(Array.from({ length: 8 }, (_, i) => checkins.checkIn(
    { ticketToken: ticket.ticketPayload, type: 'FIELD_TRIP_RETURN' }, { ...admin, uid: `staff-${i}` })));
  assert.equal(race.filter((item) => item.outcome === 'ALREADY_CHECKED_IN').length, 8);
});

test('checkout group mappings enforce current assignment without changing checkout identity', async () => {
  const cases = [
    ...['SANJOSE', 'SANTHOME', 'HOLY_CROSS', 'ALPHONSA', 'PG_HOUSE_NEAR_COLLEGE'].map((hostel) =>
      ({ group: hostel, accommodation: { isHosteller: true, hostel, needsStay: false, stayType: null } })),
    ...['AC', 'NON_AC'].map((stayType) =>
      ({ group: 'STAY', accommodation: { isHosteller: false, hostel: null, needsStay: true, stayType } })),
  ];
  for (const [index, item] of cases.entries()) {
    const ref = await seedRegistration({ id: `group-${index}`, registrationId: `VYR26-${String(index).padStart(20, '0')}`, accommodation: item.accommodation });
    const ticket = await tickets.issueForRegistrationRef(ref);
    const pending = (await checkins.summary({ type: 'EVENT' }, admin)).remaining.find((item) => item.registrationId === ticket.registration.registrationId);
    assert.equal(pending.accommodationGroup, item.group);
    assert.equal(pending.stayType, item.group === 'STAY' ? item.accommodation.stayType : undefined);
    await assert.rejects(checkins.checkIn({ ticketToken: ticket.ticketPayload, type: 'DAY1_CHECK_OUT', accommodationGroup: item.group === 'SANJOSE' ? 'SANTHOME' : 'SANJOSE' }, admin),
      { code: 'ACCOMMODATION_GROUP_MISMATCH' });
    assert.equal((await checkins.checkIn({ ticketToken: ticket.ticketPayload, type: 'DAY1_CHECK_OUT', accommodationGroup: item.group }, admin)).outcome, 'CHECKED_IN');
    assert.equal((await checkins.checkIn({ ticketToken: ticket.ticketPayload, type: 'DAY1_CHECK_OUT', accommodationGroup: 'ALL' }, admin)).outcome, 'ALREADY_CHECKED_IN');
    await checkins.checkIn({ ticketToken: ticket.ticketPayload, type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
    assert.equal((await checkins.checkIn({ ticketToken: ticket.ticketPayload, type: 'DAY2_CHECK_OUT', accommodationGroup: 'ALL' }, admin)).outcome, 'CHECKED_IN');
  }
  assert.equal((await db.collection('checkins').get()).size, cases.length * 3);
});

test('summary derives expected, scanned and remaining from eligible registrations in each scope', async () => {
  const alpha = await seedRegistration({ id: 'alpha', registrationId: 'VYR26-ALPHA', accommodation: { isHosteller: true, hostel: 'SANTHOME', needsStay: false, stayType: null } });
  const beta = await seedRegistration({ id: 'beta', registrationId: 'VYR26-BETA', workshopId: 'data-science', accommodation: { isHosteller: false, hostel: null, needsStay: true, stayType: 'NON_AC' } });
  await beta.update({ phone: '+91 98765-43211', healthSafetyNote: 'PRIVATE HEALTH', ticketPayload: 'PRIVATE QR', viewTokenHash: 'PRIVATE VIEW' });
  await seedRegistration({ id: 'pending', registrationId: 'VYR26-PENDING', registrationStatus: 'PAYMENT_PENDING', paymentStatus: 'PENDING' });
  const alphaTicket = await tickets.issueForRegistrationRef(alpha);
  const betaTicket = await tickets.issueForRegistrationRef(beta);
  const workshop = await checkins.summary({ type: 'WORKSHOP', workshopId: 'data-science' }, admin);
  assert.deepEqual([workshop.expected, workshop.scanned, workshop.remainingCount], [1, 0, 1]);
  assert.equal(workshop.remaining[0].phone, '+91 98765-43211');
  assert.equal(workshop.remaining[0].day1Absent, true);
  assert.equal(workshop.remaining[0].accommodationGroup, 'STAY'); assert.equal(workshop.remaining[0].stayType, 'NON_AC');
  assert.deepEqual(Object.keys(workshop.remaining[0]).sort(), ['accommodationGroup', 'day1Absent', 'fullName', 'phone', 'registrationId', 'stayType', 'workshopId']);
  await beta.update({ phone: null });
  assert.equal((await checkins.summary({ type: 'WORKSHOP', workshopId: 'data-science' }, admin)).remaining[0].phone, null);
  await beta.update({ phone: '+91 98765-43211' });
  await checkins.checkIn({ ticketToken: alphaTicket.ticketPayload, type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
  await checkins.checkIn({ ticketToken: betaTicket.ticketPayload, type: 'WORKSHOP', workshopId: 'data-science' }, admin);
  await checkins.checkIn({ ticketToken: alphaTicket.ticketPayload, type: 'FIELD_TRIP_DEPARTURE' }, admin);
  await checkins.checkIn({ ticketToken: alphaTicket.ticketPayload, type: 'DAY1_CHECK_OUT', accommodationGroup: 'SANTHOME' }, admin);
  const departure = await checkins.summary({ type: 'FIELD_TRIP_DEPARTURE' }, admin);
  const returning = await checkins.summary({ type: 'FIELD_TRIP_RETURN' }, admin);
  assert.deepEqual([departure.expected, departure.scanned, departure.remainingCount], [2, 1, 1]);
  assert.deepEqual([returning.expected, returning.scanned, returning.remainingCount], [1, 0, 1]);
  assert.deepEqual(returning.remaining.map((item) => item.registrationId), ['VYR26-ALPHA']);
  assert.deepEqual(departure.remaining.map((item) => item.registrationId), ['VYR26-BETA']);
  assert.deepEqual(departure.scannedParticipants.map((item) => item.registrationId), ['VYR26-ALPHA']);
  assert.deepEqual(returning.scannedParticipants, []);
  const scannedWorkshop = await checkins.summary({ type: 'WORKSHOP', workshopId: 'data-science' }, admin);
  assert.deepEqual(scannedWorkshop.scannedParticipants.map((item) => item.registrationId), ['VYR26-BETA']);
  assert.doesNotMatch(JSON.stringify(scannedWorkshop.scannedParticipants), /email|healthSafety|qrToken|ticketPayload|viewToken|recoveryToken|razorpay|PRIVATE/);
  assert.deepEqual(Object.keys(departure.remaining[0]).sort(), ['accommodationGroup', 'fullName', 'phone', 'registrationId', 'stayType']);
  assert.equal(departure.remaining[0].phone, '+91 98765-43211');
  assert.doesNotMatch(JSON.stringify(returning.remaining), /email|healthSafety|qrToken|ticketPayload|viewToken|recoveryToken|razorpay|PRIVATE/);
  const santhome = await checkins.summary({ type: 'DAY1_CHECK_OUT', accommodationGroup: 'SANTHOME' }, admin);
  const stay = await checkins.summary({ type: 'DAY1_CHECK_OUT', accommodationGroup: 'STAY' }, admin);
  assert.deepEqual([santhome.expected, santhome.scanned, stay.expected, stay.scanned], [1, 1, 1, 0]);
  assert.deepEqual(santhome.scannedParticipants.map((item) => item.registrationId), ['VYR26-ALPHA']);
  assert.deepEqual(stay.scannedParticipants, []);
  assert.equal(stay.remaining[0].accommodationGroup, 'STAY');
  assert.equal(stay.remaining[0].phone, '+91 98765-43211');
  assert.equal(stay.remaining[0].stayType, 'NON_AC');
  assert.deepEqual(Object.keys(stay.remaining[0]).sort(), ['accommodationGroup', 'fullName', 'phone', 'registrationId', 'stayType']);
  await db.doc('checkins/outside-population').set({ type: 'FIELD_TRIP_DEPARTURE', registrationDocId: 'unrelated' });
  assert.equal((await checkins.summary({ type: 'FIELD_TRIP_DEPARTURE' }, admin)).scanned, 1);
  assert.deepEqual(Object.keys(stay).sort(), ['accommodationGroup', 'expected', 'remaining', 'remainingCount', 'scanned', 'scannedParticipants', 'type', 'workshopId']);
  await assert.rejects(checkins.summary({ type: 'EVENT' }, null), { code: 'FORBIDDEN' });
});

test('simultaneous first scans at a new checkpoint have one winner', async () => {
  const ref = await seedRegistration();
  const ticket = await tickets.issueForRegistrationRef(ref);
  await checkins.checkIn({ ticketToken: ticket.ticketPayload, type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
  await checkins.checkIn({ ticketToken: ticket.ticketPayload, type: 'FIELD_TRIP_DEPARTURE' }, admin);
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) => checkins.checkIn(
    { ticketToken: ticket.ticketPayload, type: 'FIELD_TRIP_RETURN' }, { ...admin, uid: `return-staff-${index}` })));
  assert.equal(results.filter((item) => item.outcome === 'CHECKED_IN').length, 1);
  assert.equal(results.filter((item) => item.outcome === 'ALREADY_CHECKED_IN').length, 5);
  assert.equal((await db.collection('checkins').get()).size, 3);
});

test('unconfirmed or cancelled registrations cannot create field-trip attendance', async () => {
  const ref = await seedRegistration();
  const ticket = await tickets.issueForRegistrationRef(ref);
  for (const registrationStatus of ['PAYMENT_PENDING', 'CANCELLED']) {
    await ref.update({ registrationStatus });
    await assert.rejects(checkins.checkIn({ ticketToken: ticket.ticketPayload, type: 'FIELD_TRIP_DEPARTURE' }, admin),
      { code: 'REGISTRATION_NOT_CONFIRMED' });
    await assert.rejects(checkins.checkIn({ ticketToken: ticket.ticketPayload, type: 'FIELD_TRIP_RETURN' }, admin),
      { code: 'REGISTRATION_NOT_CONFIRMED' });
  }
  assert.equal((await db.collection('checkins').get()).size, 0);
});

for (const role of ['ADMIN', 'COORDINATOR']) test(`${role} name search uses canonical eligible registrations and a minimal projection`, async () => {
  for (const [id, publicId, fullName] of [
    ['name-a', 'VYR26-A', 'Abdul Basith PV'], ['name-b', 'VYR26-B', 'Abdul Basith PV'],
    ['name-c', 'VYR26-C', 'Abdul Rahman'],
  ]) {
    const ref = await seedRegistration({ id, registrationId: publicId,
      accommodation: { isHosteller: true, hostel: 'SANJOSE' } });
    await ref.update({ fullName, healthSafetyNote: 'PRIVATE HEALTH', razorpayPaymentId: 'PRIVATE PAYMENT' });
    await tickets.issueForRegistrationRef(ref);
  }
  const unpaid = await seedRegistration({ id: 'unpaid', registrationId: 'VYR26-UNPAID' });
  await unpaid.update({ fullName: 'Abdul Unpaid' }); await tickets.issueForRegistrationRef(unpaid);
  await unpaid.update({ paymentStatus: 'PENDING' });
  const revoked = await seedRegistration({ id: 'revoked', registrationId: 'VYR26-REVOKED' });
  await revoked.update({ fullName: 'Abdul Revoked' }); await tickets.issueForRegistrationRef(revoked);
  await db.doc('tickets/revoked').update({ active: false });
  const unissued = await seedRegistration({ id: 'unissued', registrationId: 'VYR26-UNISSUED' });
  await unissued.update({ fullName: 'Abdul Unissued' });
  const staff = { ...admin, role };
  for (const [search, count] of [['aBDuL', 3], ['basith', 2], ['Abdul Basith', 2], ['  Abdul   Basith  ', 2], ['Nobody', 0]]) {
    const result = await checkins.searchParticipants({ search }, staff);
    assert.equal(result.participants.length, count);
    for (const participant of result.participants) {
      assert.deepEqual(Object.keys(participant).sort(), ['accommodationGroup', 'fullName', 'registrationDocId', 'registrationId', 'workshopId']);
      assert.equal(participant.accommodationGroup, 'SANJOSE');
    }
  }
  assert.equal((await checkins.searchParticipants({ search: 'Basith' }, staff)).participants[0].registrationDocId, 'name-a');
  assert.deepEqual(await checkins.searchParticipants({ search: '' }, staff), { participants: [] });
  await assert.rejects(checkins.searchParticipants({ search: 'Abdul' }, null), { code: 'FORBIDDEN' });
  await assert.rejects(checkins.searchParticipants({ search: 'Abdul' }, { uid: 'x', role: 'PARTICIPANT' }), { code: 'FORBIDDEN' });
  await assert.rejects(checkins.searchParticipants({ search: ['Abdul'] }, staff), { code: 'INVALID_CHECKIN_REQUEST' });
});

for (const type of ['EVENT', 'WORKSHOP', 'DAY1_CHECK_OUT', 'FIELD_TRIP_DEPARTURE', 'FIELD_TRIP_RETURN', 'DAY2_CHECK_OUT']) {
  test(`manual ${type} uses canonical attendance, duplicate result, and summary`, async () => {
    const ref = await seedRegistration({ accommodation: { isHosteller: true, hostel: 'SANTHOME' } });
    const issued = await tickets.issueForRegistrationRef(ref);
    const selection = { type, ...(type === 'WORKSHOP' ? { workshopId: 'github-ai' } : {}),
      ...(['DAY1_CHECK_OUT', 'DAY2_CHECK_OUT'].includes(type) ? { accommodationGroup: 'SANTHOME' } : {}) };
    if (['FIELD_TRIP_DEPARTURE', 'FIELD_TRIP_RETURN', 'DAY2_CHECK_OUT'].includes(type)) {
      await checkins.checkIn({ registrationDocId: ref.id, type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
    }
    if (type === 'FIELD_TRIP_RETURN') await checkins.checkIn({ registrationDocId: ref.id, type: 'FIELD_TRIP_DEPARTURE' }, admin);
    const previousCount = (await db.collection('checkins').get()).size;
    const before = await checkins.summary(selection, admin);
    assert.equal(before.expected, 1); assert.equal(before.remainingCount, 1);
    assert.deepEqual(before.scannedParticipants, []);
    assert.equal(before.remaining[0].phone, '9876543210');
    assert.equal(before.remaining[0].accommodationGroup, 'SANTHOME');
    const manual = await checkins.checkIn({ registrationDocId: ref.id, ...selection }, admin);
    assert.equal(manual.outcome, 'CHECKED_IN');
    const duplicate = await checkins.checkIn({ registrationDocId: ref.id, ...selection }, admin);
    assert.equal(duplicate.outcome, 'ALREADY_CHECKED_IN');
    assert.equal(duplicate.checkedInAt, manual.checkedInAt);
    const qrDuplicate = await checkins.checkIn({ ticketToken: issued.ticketPayload, ...selection }, admin);
    assert.deepEqual(qrDuplicate, duplicate);
    const after = await checkins.summary(selection, admin);
    assert.equal(after.expected, 1); assert.equal(after.scanned, 1); assert.equal(after.remainingCount, 0);
    assert.deepEqual(after.remaining, []);
    assert.equal(after.scannedParticipants.length, after.scanned);
    assert.equal(after.scannedParticipants[0].registrationId, issued.registration.registrationId);
    assert.equal(after.scannedParticipants[0].checkedInAt, manual.checkedInAt);
    assert.equal(after.scannedParticipants[0].phone, '9876543210');
    assert.deepEqual(Object.keys(after.scannedParticipants[0]).sort(), ['accommodationGroup', 'checkedInAt',
      ...(type === 'WORKSHOP' ? ['day1Absent'] : []), 'fullName', 'phone', 'registrationId', ...(type === 'WORKSHOP' ? ['workshopId'] : [])].sort());
    assert.equal((await db.collection('checkins').get()).size, previousCount + 1);
    const stored = (await db.collection('checkins').where('type', '==', type).get()).docs;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].data().checkedInBy, admin.uid);
    assert.equal(stored[0].data().registrationDocId, ref.id);
    assert.equal(stored[0].data().ticketId, issued.ticket.ticketId);
  });
}

test('manual selection preserves workshop and accommodation mismatch errors with no write', async () => {
  const ref = await seedRegistration({ accommodation: { isHosteller: true, hostel: 'ALPHONSA' } });
  await tickets.issueForRegistrationRef(ref);
  await assert.rejects(checkins.checkIn({ registrationDocId: ref.id, type: 'WORKSHOP', workshopId: 'data-science' }, admin), { code: 'WORKSHOP_MISMATCH' });
  for (const type of ['DAY1_CHECK_OUT', 'DAY2_CHECK_OUT']) {
    await assert.rejects(checkins.checkIn({ registrationDocId: ref.id, type, accommodationGroup: 'SANTHOME' }, admin),
      (error) => error.code === 'ACCOMMODATION_GROUP_MISMATCH' && error.details.registeredGroup === 'ALPHONSA' && error.details.selectedGroup === 'SANTHOME');
  }
  assert.equal((await db.collection('checkins').get()).size, 0);
});

test('manual field trip uses committed Workshop then departure prerequisites', async () => {
  const ref = await seedRegistration(); await tickets.issueForRegistrationRef(ref);
  await assert.rejects(checkins.checkIn({ registrationDocId: ref.id, type: 'FIELD_TRIP_DEPARTURE' }, admin), { code: 'WORKSHOP_CHECKIN_REQUIRED' });
  await checkins.checkIn({ registrationDocId: ref.id, type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
  for (const type of ['FIELD_TRIP_DEPARTURE', 'FIELD_TRIP_RETURN']) {
    assert.equal((await checkins.checkIn({ registrationDocId: ref.id, type }, admin)).outcome, 'CHECKED_IN');
  }
  assert.equal((await db.collection('checkins').get()).size, 3);
});

test('QR and manual requests racing share exactly one deterministic attendance record', async () => {
  const ref = await seedRegistration(); const issued = await tickets.issueForRegistrationRef(ref);
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => checkins.checkIn({
    ...(index % 2 ? { registrationDocId: ref.id } : { ticketToken: issued.ticketPayload }), type: 'EVENT',
  }, admin)));
  assert.equal(results.filter((item) => item.outcome === 'CHECKED_IN').length, 1);
  assert.equal(results.filter((item) => item.outcome === 'ALREADY_CHECKED_IN').length, 9);
  assert.equal((await db.collection('checkins').get()).size, 1);
});

test('manual selection revalidates eligibility and ticket integrity after search', async () => {
  const ref = await seedRegistration(); await tickets.issueForRegistrationRef(ref);
  const input = { registrationDocId: ref.id, type: 'EVENT' };
  for (const patch of [{ paymentStatus: 'PENDING' }, { registrationStatus: 'CANCELLED' }]) {
    await ref.update(patch);
    await assert.rejects(checkins.checkIn(input, admin), { code: 'REGISTRATION_NOT_CONFIRMED' });
    await ref.update({ paymentStatus: 'PAID', registrationStatus: 'CONFIRMED' });
  }
  await db.doc(`tickets/${ref.id}`).update({ active: false });
  await assert.rejects(checkins.checkIn(input, admin), { code: 'TICKET_REVOKED' });
  await db.doc(`tickets/${ref.id}`).update({ active: true });
  await ref.update({ ticketIssued: false });
  await assert.rejects(checkins.checkIn(input, admin), { code: 'INVALID_TICKET' });
  await ref.update({ ticketIssued: true });
  await db.doc(`tickets/${ref.id}`).update({ registrationDocId: 'another-registration' });
  await assert.rejects(checkins.checkIn(input, admin), { code: 'INVALID_TICKET' });
  for (const invalid of [{ fullName: 'Ticket Participant', type: 'EVENT' }, { ...input, ticketToken: 'x' },
    { ...input, registrationDocId: '../x' }, { ...input, registrationDocId: '' }]) {
    await assert.rejects(checkins.checkIn(invalid, admin), { code: 'INVALID_CHECKIN_REQUEST' });
  }
  await assert.rejects(checkins.checkIn(input, null), { code: 'FORBIDDEN' });
  assert.equal((await db.collection('checkins').get()).size, 0);
});

test('Day 1 absence is derived by canonical identity and never blocks or mutates Workshop participants', async () => {
  const present = await seedRegistration({ id: 'day1-present', registrationId: 'VYR26-PRESENT' });
  const absent = await seedRegistration({ id: 'day1-absent', registrationId: 'VYR26-ABSENT' });
  const presentTicket = await tickets.issueForRegistrationRef(present);
  const absentTicket = await tickets.issueForRegistrationRef(absent);
  await checkins.checkIn({ ticketToken: presentTicket.ticketPayload, type: 'EVENT' }, admin);
  // A lookalike noncanonical document must not substitute for EVENT evidence.
  await db.doc('checkins/not-canonical-event').set({ type: 'EVENT', workshopId: null, registrationDocId: absent.id });
  const snapshots = await Promise.all([present.get(), absent.get(), db.doc(`tickets/${present.id}`).get(), db.doc(`tickets/${absent.id}`).get()]);
  const summary = await checkins.summary({ type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
  assert.ok(summary.remaining.every((item) => item.accommodationGroup === null && !Object.hasOwn(item, 'stayType')));
  const flags = new Map(summary.remaining.map((item) => [item.registrationId, item.day1Absent]));
  assert.equal(flags.get('VYR26-PRESENT'), false); assert.equal(flags.get('VYR26-ABSENT'), true);
  const attended = await checkins.checkIn({ ticketToken: presentTicket.ticketPayload, type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
  const noShow = await checkins.checkIn({ registrationDocId: absent.id, type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
  assert.equal(attended.participant.day1Absent, false);
  assert.equal(noShow.outcome, 'CHECKED_IN'); assert.equal(noShow.participant.day1Absent, true);
  assert.equal((await checkins.checkIn({ ticketToken: absentTicket.ticketPayload, type: 'WORKSHOP', workshopId: 'github-ai' }, admin)).participant.day1Absent, true);
  for (const old of snapshots) {
    const current = await old.ref.get(); assert.deepEqual(current.data(), old.data()); assert.ok(current.updateTime.isEqual(old.updateTime));
  }
  for (const doc of (await db.collection('checkins').get()).docs) assert.equal(doc.data().day1Absent, undefined);
});

for (const mode of ['QR', 'manual']) for (const [type, code] of [
  ['FIELD_TRIP_DEPARTURE', 'WORKSHOP_CHECKIN_REQUIRED'],
  ['FIELD_TRIP_RETURN', 'FIELD_TRIP_DEPARTURE_REQUIRED'],
  ['DAY2_CHECK_OUT', 'DAY2_ATTENDANCE_REQUIRED'],
]) test(`${mode} ${type} enforces committed prerequisites and preserves duplicate identity`, async () => {
  const ref = await seedRegistration(); const issued = await tickets.issueForRegistrationRef(ref);
  const identity = mode === 'QR' ? { ticketToken: issued.ticketPayload } : { registrationDocId: ref.id };
  const selection = { type, ...(type === 'DAY2_CHECK_OUT' ? { accommodationGroup: 'ALL' } : {}) };
  await checkins.checkIn({ registrationDocId: ref.id, type: 'EVENT' }, admin);
  const before = await checkins.summary(selection, admin);
  assert.deepEqual([before.expected, before.scanned, before.remainingCount, before.remaining.length], [0, 0, 0, 0]);
  const recordsBefore = (await db.collection('checkins').get()).size;
  await assert.rejects(checkins.checkIn({ ...identity, ...selection }, admin), { code });
  assert.equal((await db.collection('checkins').get()).size, recordsBefore);
  await checkins.checkIn({ registrationDocId: ref.id, type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
  if (type === 'FIELD_TRIP_RETURN') {
    await assert.rejects(checkins.checkIn({ ...identity, ...selection }, admin), { code });
    assert.equal((await checkins.summary(selection, admin)).expected, 0);
    await checkins.checkIn({ registrationDocId: ref.id, type: 'FIELD_TRIP_DEPARTURE' }, admin);
  }
  const eligible = await checkins.summary(selection, admin);
  assert.deepEqual([eligible.expected, eligible.scanned, eligible.remainingCount], [1, 0, 1]);
  const success = await checkins.checkIn({ ...identity, ...selection }, admin);
  const duplicate = await checkins.checkIn({ ...identity, ...selection }, admin);
  assert.equal(success.outcome, 'CHECKED_IN'); assert.equal(duplicate.outcome, 'ALREADY_CHECKED_IN');
  assert.equal(duplicate.checkedInAt, success.checkedInAt);
  assert.equal((await db.collection('checkins').where('type', '==', type).get()).size, 1);
  const after = await checkins.summary(selection, admin);
  assert.deepEqual([after.expected, after.scanned, after.remainingCount], [1, 1, 0]); assert.deepEqual(after.remaining, []);
});

for (const evidence of [
  ['WORKSHOP'], ['WORKSHOP', 'FIELD_TRIP_DEPARTURE'], ['WORKSHOP', 'FIELD_TRIP_DEPARTURE', 'FIELD_TRIP_RETURN'],
  ['FIELD_TRIP_DEPARTURE'], ['FIELD_TRIP_RETURN'],
]) test(`Day 2 checkout accepts and deduplicates ${evidence.join(' + ')} without rewriting evidence`, async () => {
  const ref = await seedRegistration({ accommodation: { isHosteller: false, needsStay: true, stayType: 'NON_AC' } });
  const issued = await tickets.issueForRegistrationRef(ref);
  const historical = [];
  for (const type of evidence) historical.push(await historicalAttendance(ref, type, type === 'WORKSHOP' ? 'github-ai' : null));
  const selection = { type: 'DAY2_CHECK_OUT', accommodationGroup: 'STAY' };
  assert.equal((await checkins.summary({ type: 'DAY2_CHECK_OUT', accommodationGroup: 'SANTHOME' }, admin)).expected, 0);
  await assert.rejects(checkins.checkIn({ registrationDocId: ref.id, ...selection, accommodationGroup: 'SANTHOME' }, admin), { code: 'ACCOMMODATION_GROUP_MISMATCH' });
  const before = await checkins.summary(selection, admin);
  assert.deepEqual([before.expected, before.scanned, before.remainingCount], [1, 0, 1]);
  assert.equal(before.remaining[0].phone, '9876543210'); assert.equal(before.remaining[0].accommodationGroup, 'STAY');
  const result = await checkins.checkIn({ ticketToken: issued.ticketPayload, ...selection }, admin);
  assert.equal(result.outcome, 'CHECKED_IN');
  const after = await checkins.summary(selection, admin);
  assert.deepEqual([after.expected, after.scanned, after.remainingCount], [1, 1, 0]); assert.deepEqual(after.remaining, []);
  for (const old of historical) { const current = await old.ref.get(); assert.deepEqual(current.data(), old.data()); assert.ok(current.updateTime.isEqual(old.updateTime)); }
  if (evidence.length === 1 && evidence[0] === 'WORKSHOP') {
    assert.equal((await db.collection('checkins').where('type', '==', 'FIELD_TRIP_DEPARTURE').get()).size, 0);
    // Early checkout does not revoke subsequent field-trip eligibility.
    assert.equal((await checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'FIELD_TRIP_DEPARTURE' }, admin)).outcome, 'CHECKED_IN');
  }
});

test('Day 2 summaries agree with canonical sets and use bounded queries independent of roster size', async () => {
  const evidence = [['WORKSHOP'], ['WORKSHOP', 'FIELD_TRIP_DEPARTURE'], ['WORKSHOP', 'FIELD_TRIP_DEPARTURE', 'FIELD_TRIP_RETURN'], [], ['FIELD_TRIP_RETURN']];
  for (const [index, types] of evidence.entries()) {
    const ref = await seedRegistration({ id: `population-${index}`, registrationId: `VYR26-${index}` });
    await tickets.issueForRegistrationRef(ref);
    for (const type of types) await historicalAttendance(ref, type, type === 'WORKSHOP' ? 'github-ai' : null);
  }
  // Duplicate-looking/noncanonical documents are neither prerequisite evidence nor extra people.
  await db.doc('checkins/lookalike-workshop').set({ type: 'WORKSHOP', workshopId: 'github-ai', registrationDocId: 'population-3' });
  await db.doc('checkins/lookalike-departure').set({ type: 'FIELD_TRIP_DEPARTURE', workshopId: null, registrationDocId: 'population-3' });
  await db.doc('checkins/lookalike-return').set({ type: 'FIELD_TRIP_RETURN', workshopId: null, registrationDocId: 'population-3' });
  let queries = 0;
  const measured = createCheckinService({ db: { collection(name) {
    const collection = db.collection(name);
    return { get() { queries++; return collection.get(); }, where(...args) {
      const query = collection.where(...args); return { get() { queries++; return query.get(); } };
    } };
  } }, ticketService: tickets });
  for (const [selection, counts, pending, queryCount] of [
    [{ type: 'FIELD_TRIP_DEPARTURE' }, [3, 2, 1], ['VYR26-0'], 3],
    [{ type: 'FIELD_TRIP_RETURN' }, [2, 1, 1], ['VYR26-1'], 3],
    [{ type: 'DAY2_CHECK_OUT', accommodationGroup: 'ALL' }, [4, 0, 4], ['VYR26-0', 'VYR26-1', 'VYR26-2', 'VYR26-4'], 5],
  ]) {
    queries = 0; const summary = await measured.summary(selection, admin);
    assert.deepEqual([summary.expected, summary.scanned, summary.remainingCount], counts);
    assert.deepEqual(summary.remaining.map((item) => item.registrationId).sort(), pending);
    assert.equal(summary.scannedParticipants.length, summary.scanned);
    assert.equal(summary.scannedParticipants.length + summary.remaining.length, summary.expected);
    assert.ok(summary.scannedParticipants.every((item) => !pending.includes(item.registrationId)));
    assert.equal(queries, queryCount);
  }
  await assert.rejects(checkins.checkIn({ registrationDocId: 'population-3', type: 'FIELD_TRIP_DEPARTURE' }, admin), { code: 'WORKSHOP_CHECKIN_REQUIRED' });
  await assert.rejects(checkins.checkIn({ registrationDocId: 'population-3', type: 'FIELD_TRIP_RETURN' }, admin), { code: 'FIELD_TRIP_DEPARTURE_REQUIRED' });
  await assert.rejects(checkins.checkIn({ registrationDocId: 'population-3', type: 'DAY2_CHECK_OUT', accommodationGroup: 'ALL' }, admin), { code: 'DAY2_ATTENDANCE_REQUIRED' });
});

for (const type of ['FIELD_TRIP_DEPARTURE', 'FIELD_TRIP_RETURN', 'DAY2_CHECK_OUT']) test(`10 QR/manual ${type} requests share one canonical write`, async () => {
  const ref = await seedRegistration(); const issued = await tickets.issueForRegistrationRef(ref);
  await checkins.checkIn({ registrationDocId: ref.id, type: 'WORKSHOP', workshopId: 'github-ai' }, admin);
  if (type === 'FIELD_TRIP_RETURN') await checkins.checkIn({ registrationDocId: ref.id, type: 'FIELD_TRIP_DEPARTURE' }, admin);
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => checkins.checkIn({
    ...(index % 2 ? { registrationDocId: ref.id } : { ticketToken: issued.ticketPayload }), type,
    ...(type === 'DAY2_CHECK_OUT' ? { accommodationGroup: 'ALL' } : {}),
  }, { ...admin, uid: `day2-staff-${index}` })));
  assert.equal(results.filter((item) => item.outcome === 'CHECKED_IN').length, 1);
  assert.equal(results.filter((item) => item.outcome === 'ALREADY_CHECKED_IN').length, 9);
  assert.equal((await db.collection('checkins').where('type', '==', type).get()).size, 1);
});

test('historical Day 1 records, identities and timestamps stay unchanged through Day 2 operations', async () => {
  const ref = await seedRegistration(); const issued = await tickets.issueForRegistrationRef(ref);
  const historical = [await historicalAttendance(ref, 'EVENT'), await historicalAttendance(ref, 'DAY1_CHECK_OUT')];
  const registrationBefore = (await ref.get()).data(); const ticketBefore = (await db.doc(`tickets/${ref.id}`).get()).data();
  for (const selection of [{ type: 'EVENT' }, { type: 'DAY1_CHECK_OUT', accommodationGroup: 'ALL' },
    { type: 'WORKSHOP', workshopId: 'github-ai' }, { type: 'FIELD_TRIP_DEPARTURE' }, { type: 'FIELD_TRIP_RETURN' },
    { type: 'DAY2_CHECK_OUT', accommodationGroup: 'ALL' }]) {
    await checkins.checkIn({ ticketToken: issued.ticketPayload, ...selection }, admin);
    const summary = await checkins.summary(selection, admin);
    assert.deepEqual([summary.expected, summary.scanned, summary.remainingCount], [1, 1, 0]);
  }
  for (const old of historical) {
    const current = await old.ref.get(); assert.deepEqual(current.data(), old.data());
    assert.ok(current.createTime.isEqual(old.createTime)); assert.ok(current.updateTime.isEqual(old.updateTime));
  }
  assert.deepEqual((await ref.get()).data(), registrationBefore);
  assert.deepEqual((await db.doc(`tickets/${ref.id}`).get()).data(), ticketBefore);
  assert.equal((await db.collection('checkins').get()).size, 6);
});

test('preexisting canonical departure duplicate remains safe without retroactive prerequisite backfill', async () => {
  const ref = await seedRegistration(); const issued = await tickets.issueForRegistrationRef(ref);
  const old = await historicalAttendance(ref, 'FIELD_TRIP_DEPARTURE');
  const duplicate = await checkins.checkIn({ ticketToken: issued.ticketPayload, type: 'FIELD_TRIP_DEPARTURE' }, admin);
  assert.equal(duplicate.outcome, 'ALREADY_CHECKED_IN');
  assert.deepEqual((await old.ref.get()).data(), old.data());
  assert.equal((await db.collection('checkins').get()).size, 1);
});
