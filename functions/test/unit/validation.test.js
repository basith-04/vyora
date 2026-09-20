import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail,
  normalizeFullName,
  normalizePhone,
  validateAndNormalizeRegistration,
} from '../../src/validation/registration.js';

const valid = {
  fullName: 'Test Participant',
  email: 'test@example.com',
  phone: '9876543210',
  year: 2,
  department: 'CSE',
  class: 'CSE B',
  ieeeMember: false,
  ieeeMembershipId: null,
  isHosteller: false,
  hostel: null,
  needsStay: false,
  stayType: null,
  workshopId: 'github-ai',
};

function errorFor(input) {
  try {
    validateAndNormalizeRegistration(input);
    assert.fail('Expected validation to fail.');
  } catch (error) {
    return error;
  }
}

test('accepts and normalizes a valid registration', () => {
  const result = validateAndNormalizeRegistration({
    ...valid,
    fullName: '  Test   Participant  ',
    email: '  TEST@Example.COM ',
    phone: '+91 98765-43210',
  });
  assert.equal(result.fullName, 'Test Participant');
  assert.equal(result.email, 'test@example.com');
  assert.equal(result.phone, '9876543210');
});

test('normalization helpers are deterministic', () => {
  assert.equal(normalizeFullName('  Ada   Lovelace '), 'Ada Lovelace');
  assert.equal(normalizeEmail(' User@Example.COM '), 'user@example.com');
  assert.equal(normalizePhone('09876543210'), '9876543210');
});

test('rejects an invalid year', () => {
  const error = errorFor({ ...valid, year: 5 });
  assert.equal(error.code, 'INVALID_PARTICIPANT_DATA');
  assert.ok(error.details.fields.year);
});

test('rejects an invalid workshop', () => {
  const error = errorFor({ ...valid, workshopId: 'data-science-python' });
  assert.equal(error.code, 'INVALID_PARTICIPANT_DATA');
  assert.ok(error.details.fields.workshopId);
});

test('accepts only classes belonging to each department', () => {
  for (const className of ['CSE A', 'CSE B', 'CSE C', 'CSE D']) {
    assert.equal(validateAndNormalizeRegistration({ ...valid, department: 'CSE', class: className }).class, className);
  }
  for (const className of ['ADS A', 'ADS B']) {
    assert.equal(validateAndNormalizeRegistration({ ...valid, department: 'ADS', class: className }).class, className);
  }
  for (const department of ['CSD', 'CSBS', 'CS & CY', 'ECE', 'ME/CE', 'EEE', 'AEI']) {
    const result = validateAndNormalizeRegistration({ ...valid, department, class: department });
    assert.equal(result.department, department);
    assert.equal(result.class, department);
  }
});

test('rejects mismatched, unknown, and missing department/class values', () => {
  for (const input of [
    { ...valid, department: 'CSE', class: 'ADS A' },
    { ...valid, department: 'ECE', class: 'CSE A' },
    { ...valid, department: 'TEST', class: 'ADMIN' },
    { ...valid, department: undefined },
    { ...valid, class: undefined },
  ]) {
    const error = errorFor(input);
    assert.equal(error.code, 'INVALID_PARTICIPANT_DATA');
    assert.ok(error.details.fields.department || error.details.fields.class);
  }
});

test('rejects invalid hosteller and stay combinations', () => {
  const cases = [
    { ...valid, isHosteller: true, hostel: 'SANTHOME', needsStay: true, stayType: 'AC' },
    { ...valid, isHosteller: true, hostel: 'SANTHOME', needsStay: false, stayType: 'NON_AC' },
    { ...valid, isHosteller: false, hostel: 'SANTHOME' },
    { ...valid, isHosteller: false, needsStay: false, stayType: 'AC' },
    { ...valid, isHosteller: false, needsStay: true, stayType: null },
  ];
  for (const input of cases) {
    assert.equal(errorFor(input).code, 'INVALID_ACCOMMODATION_SELECTION');
  }
});

test('requires an IEEE ID for members and null for non-members', () => {
  assert.equal(errorFor({ ...valid, ieeeMember: true, ieeeMembershipId: '' }).code, 'INVALID_PARTICIPANT_DATA');
  assert.equal(errorFor({ ...valid, ieeeMembershipId: '12345' }).code, 'INVALID_PARTICIPANT_DATA');
  assert.equal(validateAndNormalizeRegistration({
    ...valid,
    ieeeMember: true,
    ieeeMembershipId: ' 12345 ',
  }).ieeeMembershipId, '12345');
});

test('rejects client-controlled authoritative fields', () => {
  const error = errorFor({ ...valid, totalFee: 1, paymentStatus: 'PAID' });
  assert.equal(error.code, 'INVALID_PARTICIPANT_DATA');
  assert.deepEqual(error.details.fields, ['totalFee', 'paymentStatus']);
});
