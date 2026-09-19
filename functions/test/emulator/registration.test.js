import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  assertFails,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { createRegistrationService } from '../../src/services/registration.js';
import { createExpirationService } from '../../src/services/expiration.js';
import { DEFAULT_CONFIGURATION } from '../../src/config/constants.js';

const projectId = process.env.GCLOUD_PROJECT || 'demo-vyora-26';
let adminApp;
let db;
let testEnvironment;

const valid = {
  fullName: 'Test Participant',
  email: 'test@example.com',
  phone: '9876543210',
  year: 2,
  ieeeMember: false,
  ieeeMembershipId: null,
  isHosteller: false,
  hostel: null,
  needsStay: false,
  stayType: null,
  workshopId: 'github-ai',
};

async function seed(overrides = {}) {
  const now = Timestamp.now();
  const capacity = { ...DEFAULT_CONFIGURATION.capacity, ...overrides.capacity, updatedAt: now };
  const config = {
    ...DEFAULT_CONFIGURATION.registration,
    ...overrides.registration,
    pricing: DEFAULT_CONFIGURATION.registration.pricing,
    updatedAt: now,
  };
  const batch = db.batch();
  batch.set(db.doc('system/capacity'), capacity);
  batch.set(db.doc('system/registration-config'), config);
  for (const [workshopId, workshop] of Object.entries(DEFAULT_CONFIGURATION.workshops)) {
    batch.set(db.doc(`workshops/${workshopId}`), {
      ...workshop,
      ...(overrides.workshops?.[workshopId] || {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
}

async function rejectCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

before(async () => {
  adminApp = initializeApp({ projectId }, `phase1-tests-${Date.now()}`);
  db = getFirestore(adminApp);
  const rules = await readFile(new URL('../../../firestore.rules', import.meta.url), 'utf8');
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

after(async () => {
  await testEnvironment?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

test('reserves the final event seat and then returns EVENT_FULL', async () => {
  await seed({ capacity: { eventOccupied: 164 } });
  const create = createRegistrationService({ db });
  await create(valid);
  await rejectCode(create({ ...valid, email: 'other@example.com', phone: '9876543211' }), 'EVENT_FULL');
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 165);
});

test('reserves the final workshop seat and then returns WORKSHOP_FULL', async () => {
  await seed({ workshops: { 'github-ai': { occupied: 54 } } });
  const create = createRegistrationService({ db });
  await create(valid);
  await rejectCode(create({ ...valid, email: 'other@example.com', phone: '9876543211' }), 'WORKSHOP_FULL');
  assert.equal((await db.doc('workshops/github-ai').get()).data().occupied, 55);
});

test('reserves the final first-year seat and allows a later-year registration', async () => {
  await seed({ capacity: { firstYearOccupied: 54 } });
  const create = createRegistrationService({ db });
  await create({ ...valid, year: 1 });
  await rejectCode(create({ ...valid, email: 'first@example.com', phone: '9876543211', year: 1 }), 'FIRST_YEAR_FULL');
  await create({ ...valid, email: 'second@example.com', phone: '9876543212', year: 2 });
  const capacity = (await db.doc('system/capacity').get()).data();
  assert.equal(capacity.firstYearOccupied, 55);
  assert.equal(capacity.eventOccupied, 2);
});

test('two concurrent requests cannot take one remaining workshop seat', async () => {
  await seed({ workshops: { 'github-ai': { occupied: 54 } } });
  const create = createRegistrationService({ db });
  const results = await Promise.allSettled([
    create({ ...valid, email: 'a@example.com', phone: '9876543211' }),
    create({ ...valid, email: 'b@example.com', phone: '9876543212' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'WORKSHOP_FULL').length, 1);
  assert.equal((await db.doc('workshops/github-ai').get()).data().occupied, 55);
});

test('two concurrent first-year requests cannot take one remaining first-year seat', async () => {
  await seed({ capacity: { firstYearOccupied: 54 } });
  const create = createRegistrationService({ db });
  const results = await Promise.allSettled([
    create({ ...valid, year: 1, email: 'a@example.com', phone: '9876543211' }),
    create({ ...valid, year: 1, email: 'b@example.com', phone: '9876543212' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'FIRST_YEAR_FULL').length, 1);
  assert.equal((await db.doc('system/capacity').get()).data().firstYearOccupied, 55);
});

test('simultaneous duplicate attempts create only one active reservation', async () => {
  await seed();
  const create = createRegistrationService({ db });
  const results = await Promise.allSettled([create(valid), create(valid)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'DUPLICATE_REGISTRATION').length, 1);
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 1);
  assert.equal((await db.collection('registrations').get()).size, 1);
  assert.equal((await db.collection('registrationLocks').get()).size, 2);
});

test('expiration releases capacity once and permits a new attempt', async () => {
  await seed();
  const creationTime = 1_800_000_000_000;
  const createExpired = createRegistrationService({ db, clock: () => creationTime });
  const first = await createExpired({ ...valid, year: 1 });
  const expiration = createExpirationService({ db, clock: () => creationTime + 301_000 });

  assert.deepEqual(await expiration.expireRegistration(first.registrationDocId), { outcome: 'EXPIRED' });
  assert.deepEqual(await expiration.expireRegistration(first.registrationDocId), {
    outcome: 'NO_OP',
    registrationStatus: 'EXPIRED',
  });

  let capacity = (await db.doc('system/capacity').get()).data();
  assert.equal(capacity.eventOccupied, 0);
  assert.equal(capacity.firstYearOccupied, 0);
  assert.equal((await db.doc('workshops/github-ai').get()).data().occupied, 0);
  assert.equal((await db.collection('registrationLocks').get()).size, 0);

  const createAgain = createRegistrationService({ db, clock: () => creationTime + 302_000 });
  await createAgain({ ...valid, year: 1 });
  capacity = (await db.doc('system/capacity').get()).data();
  assert.equal(capacity.eventOccupied, 1);
  assert.equal(capacity.firstYearOccupied, 1);
});

test('expiration sweep evaluates the stored deadline and remains idempotent', async () => {
  await seed();
  const creationTime = 1_800_000_000_000;
  const create = createRegistrationService({ db, clock: () => creationTime });
  await create(valid);
  const expiration = createExpirationService({ db, clock: () => creationTime + 301_000 });
  assert.deepEqual(await expiration.expirePendingReservations(), { examined: 1, expired: 1 });
  assert.deepEqual(await expiration.expirePendingReservations(), { examined: 0, expired: 0 });
  assert.equal((await db.doc('system/capacity').get()).data().eventOccupied, 0);
});

test('deny-by-default rules block public reads and writes', async () => {
  await seed();
  const publicDb = testEnvironment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(publicDb, 'system', 'capacity')));
  await assertFails(setDoc(doc(publicDb, 'registrations', 'public-write'), valid));
});
