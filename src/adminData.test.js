import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFilters, filterRegistrations, hostelLabels, readableStatus } from './adminData.js';
import { CSV_FIELDS, DEFAULT_CSV_COLUMNS, ALL_CSV_COLUMNS, toggleCsvColumn, allCsvColumnsSelected } from '../functions/shared/csv-fields.js';
import { loginAdmin, logoutAdmin, observeAdmin } from './adminAuth.js';

const registrations = [
  { registrationId: 'VYR26-ALPHA', fullName: 'Alpha Person', email: 'alpha@example.com', phone: '9876500001', year: 1, department: 'CSE', class: 'CSE A', ieeeMember: true, workshopId: 'data-science', isHosteller: true, hostel: 'SANJOSE', needsStay: false, stayType: null, paymentStatus: 'PAID', registrationStatus: 'CONFIRMED', paymentReconciliationRequired: false, attendance: { event: { checkedInAt: '2026-10-09T09:00:00Z' }, workshop: null } },
  { registrationId: 'VYR26-BETA', fullName: 'Beta Person', email: 'beta@example.com', phone: '9876500002', year: 3, department: 'ECE', class: 'ECE', ieeeMember: false, workshopId: 'github-ai', isHosteller: false, hostel: null, needsStay: true, stayType: 'AC', paymentStatus: 'PENDING', registrationStatus: 'PAYMENT_PENDING', paymentReconciliationRequired: true, attendance: { event: null, workshop: { checkedInAt: '2026-10-09T14:00:00Z' } } },
];

test('admin hostel labels include PG/House Near College', () => {
  assert.equal(hostelLabels.PG_HOUSE_NEAR_COLLEGE, 'PG/House Near College');
});

test('admin search covers registration ID, name, email and phone case-insensitively', () => {
  for (const search of ['alpha', 'PERSON', 'beta@example.com', '0002']) {
    assert.equal(filterRegistrations(registrations, search, defaultFilters).length, search === 'PERSON' ? 2 : 1);
  }
});

test('admin search also matches department and class metadata', () => {
  assert.deepEqual(filterRegistrations(registrations, 'cse a', defaultFilters).map((item) => item.registrationId), ['VYR26-ALPHA']);
  assert.deepEqual(filterRegistrations(registrations, 'ece', defaultFilters).map((item) => item.registrationId), ['VYR26-BETA']);
});

test('every important admin filter category and combined filtering works', () => {
  const cases = {
    registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', year: '1', ieee: 'true',
    workshopId: 'data-science', hosteller: 'true', hostel: 'SANJOSE', stay: 'false', reconciliation: 'false', eventCheckin: 'true', workshopCheckin: 'false',
  };
  for (const [name, value] of Object.entries(cases)) {
    assert.deepEqual(filterRegistrations(registrations, '', { ...defaultFilters, [name]: value }).map((item) => item.registrationId), ['VYR26-ALPHA']);
  }
  assert.deepEqual(filterRegistrations(registrations, 'beta', { ...defaultFilters, year: '3', stayType: 'AC', reconciliation: 'true' }).map((item) => item.registrationId), ['VYR26-BETA']);
  assert.equal(filterRegistrations(registrations, '', defaultFilters).length, 2);
  assert.equal(readableStatus('NON_AC'), 'NON AC');
});

test('admin auth helpers provide login, observer and logout behavior without storing tokens', async () => {
  const auth = { marker: true };
  let observed;
  await loginAdmin(auth, ' staff@example.com ', 'password', async (received, email) => { assert.equal(received, auth); assert.equal(email, 'staff@example.com'); });
  const unsubscribe = observeAdmin(auth, (user) => { observed = user; }, (received, listener) => { listener({ uid: 'staff' }); return () => 'done'; });
  assert.equal(observed.uid, 'staff');
  assert.equal(unsubscribe(), 'done');
  let signedOut = false;
  await logoutAdmin(auth, async () => { signedOut = true; });
  assert.equal(signedOut, true);
});

test('ticket email resender reuses confirmed name search and is ADMIN only', async () => {
  const { confirmedParticipantMatches, canAccessAdminView } = await import('./adminData.js');
  const records = [
    { registrationId: 'VYR26-A', fullName: 'Devika Suresh', email: 'first@example.com', registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' },
    { registrationId: 'VYR26-B', fullName: 'Devika Kumar', email: 'second@example.com', registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' },
    { registrationId: 'VYR26-C', fullName: 'Devika Pending', registrationStatus: 'PAYMENT_PENDING', paymentStatus: 'PENDING' },
  ];
  assert.deepEqual(confirmedParticipantMatches(records, ' devika ').map((item) => item.registrationId), ['VYR26-A', 'VYR26-B']);
  assert.deepEqual(confirmedParticipantMatches(records, 'Suresh').map((item) => item.email), ['first@example.com']);
  assert.equal(canAccessAdminView('ADMIN', 'ticket-email-resender'), true);
  assert.equal(canAccessAdminView('COORDINATOR', 'ticket-email-resender'), false);
});

test('completion filters cover every option and compose with existing filters', () => {
  const records = [
    { registrationId: 'A', fullName: 'Devika', year: 2, workshopId: 'github-ai', gender: 'FEMALE', foodPreference: 'VEG', detailsCompletedAt: '2026-09-28T00:00:00Z' },
    { registrationId: 'B', fullName: 'Rahul', year: 2, workshopId: 'github-ai', gender: 'MALE', foodPreference: 'NON_VEG', detailsCompletedAt: '2026-09-28T00:00:00Z' },
    { registrationId: 'C', fullName: 'Legacy', year: 2, workshopId: 'github-ai' },
    { registrationId: 'D', fullName: 'Partial', year: 2, workshopId: 'github-ai', gender: null, foodPreference: '' },
    { registrationId: 'E', fullName: 'Devika Other', year: 1, workshopId: 'data-science', gender: 'FEMALE', foodPreference: 'VEG', detailsCompletedAt: '2026-09-28T00:00:00Z' },
  ];
  const ids = (extra, search = '') => filterRegistrations(records, search, { ...defaultFilters, ...extra }).map((item) => item.registrationId);
  assert.deepEqual(ids({ gender: '' }), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(ids({ gender: 'MALE' }), ['B']);
  assert.deepEqual(ids({ gender: 'FEMALE' }), ['A', 'E']);
  assert.deepEqual(ids({ gender: 'NOT_PROVIDED' }), ['C', 'D']);
  assert.deepEqual(ids({ foodPreference: '' }), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(ids({ foodPreference: 'VEG' }), ['A', 'E']);
  assert.deepEqual(ids({ foodPreference: 'NON_VEG' }), ['B']);
  assert.deepEqual(ids({ foodPreference: 'NOT_PROVIDED' }), ['C', 'D']);
  assert.deepEqual(ids({ completionDetails: '' }), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(ids({ completionDetails: 'COMPLETED' }), ['A', 'B', 'E']);
  assert.deepEqual(ids({ completionDetails: 'NOT_COMPLETED' }), ['C', 'D']);
  assert.deepEqual(ids({ gender: 'FEMALE', foodPreference: 'VEG', completionDetails: 'COMPLETED', workshopId: 'github-ai', year: '2' }, 'Devika'), ['A']);
  assert.deepEqual(ids({ year: '2', completionDetails: 'NOT_COMPLETED' }), ['C', 'D']);
  assert.deepEqual(DEFAULT_CSV_COLUMNS, ['fullName', 'email', 'phone', 'year', 'workshop']);
  assert.equal(ALL_CSV_COLUMNS.length, CSV_FIELDS.length);
  assert.equal(allCsvColumnsSelected(ALL_CSV_COLUMNS), true);
  const removed = toggleCsvColumn(ALL_CSV_COLUMNS, 'gender');
  assert.equal(allCsvColumnsSelected(removed), false);
  assert.equal(toggleCsvColumn(removed, 'gender').length, ALL_CSV_COLUMNS.length);
  assert.deepEqual(toggleCsvColumn([], 'unsafe'), []);
  assert.equal(CSV_FIELDS.some((field) => /health|token|hash/i.test(field.key)), false);
});
