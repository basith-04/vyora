import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegistrationSubmission,
  calculateFees,
  initialRegistration,
  normalizePhone,
  updateRegistrationField,
  validateRegistration,
} from './registrationValidation.js';
import { hostels } from './registrationOptions.js';

const valid = {
  ...initialRegistration,
  fullName: 'Test Participant',
  email: 'test@example.com',
  phone: '9876543210',
  year: 3,
  ieeeMember: false,
  ieeeMembershipId: null,
  isHosteller: false,
  needsStay: false,
  workshopId: 'github-ai',
};

test('normalizes Indian mobile numbers and country-code autofill', () => {
  assert.equal(normalizePhone('+91 98765-43210'), '9876543210');
  assert.equal(normalizePhone('09876543210'), '9876543210');
});

test('requires IEEE ID only for IEEE members', () => {
  assert.deepEqual(validateRegistration(valid), {});
  assert.equal(validateRegistration({ ...valid, ieeeMember: true, ieeeMembershipId: '' }).ieeeMembershipId, 'IEEE MEMBERSHIP ID IS REQUIRED.');
  assert.deepEqual(validateRegistration({ ...valid, ieeeMember: true, ieeeMembershipId: ' 12345 ' }), {});
  assert.equal(validateRegistration({ ...valid, ieeeMember: null }).ieeeMember, 'SELECT YOUR IEEE STATUS.');
});

test('reports missing participant and workshop fields', () => {
  const errors = validateRegistration(initialRegistration);
  assert.equal(errors.fullName, 'ENTER YOUR FULL NAME.');
  assert.equal(errors.email, 'ENTER A VALID EMAIL ADDRESS.');
  assert.equal(errors.phone, 'ENTER A 10-DIGIT MOBILE NUMBER.');
  assert.equal(errors.year, 'SELECT YOUR YEAR OF STUDY.');
  assert.equal(errors.isHosteller, 'SELECT YOUR HOSTELLER STATUS.');
  assert.equal(errors.workshopId, 'SELECT ONE AIDEX WORKSHOP.');
});

test('calculates every IEEE and accommodation combination', () => {
  for (const hostel of hostels) {
    const ieeeHosteller = { ...valid, ieeeMember: true, ieeeMembershipId: '12345', isHosteller: true, hostel: hostel.id, needsStay: false };
    const nonIeeeHosteller = { ...ieeeHosteller, ieeeMember: false, ieeeMembershipId: null };
    assert.deepEqual(validateRegistration(ieeeHosteller), {});
    assert.deepEqual(calculateFees(ieeeHosteller), { baseFee: 399, stayFee: 0, totalFee: 399 });
    assert.deepEqual(validateRegistration(nonIeeeHosteller), {});
    assert.deepEqual(calculateFees(nonIeeeHosteller), { baseFee: 799, stayFee: 0, totalFee: 799 });
  }
  for (const [ieeeMember, baseFee] of [[true, 399], [false, 799]]) {
    for (const [stayType, stayFee] of [['NON_AC', 250], ['AC', 300]]) {
      const form = { ...valid, ieeeMember, ieeeMembershipId: ieeeMember ? '12345' : null, needsStay: true, stayType };
      assert.deepEqual(validateRegistration(form), {});
      assert.deepEqual(calculateFees(form), { baseFee, stayFee, totalFee: baseFee + stayFee });
    }
  }
});

test('requires only the visible accommodation path and clears stale selections', () => {
  assert.equal(validateRegistration({ ...valid, isHosteller: false, needsStay: null }).needsStay, 'SELECT IF YOU NEED STAY.');
  assert.equal(validateRegistration({ ...valid, isHosteller: true, hostel: null }).hostel, 'SELECT YOUR HOSTEL.');
  assert.equal(validateRegistration({ ...valid, needsStay: true, stayType: null }).stayType, 'SELECT AC OR NON-AC STAY.');

  const hosteller = updateRegistrationField({ ...valid, needsStay: true, stayType: 'AC' }, 'isHosteller', true);
  assert.equal(hosteller.needsStay, false);
  assert.equal(hosteller.stayType, null);
  assert.equal(calculateFees(hosteller).stayFee, 0);

  const nonHosteller = updateRegistrationField({ ...hosteller, hostel: 'SANTHOME' }, 'isHosteller', false);
  assert.equal(nonHosteller.hostel, null);
  assert.equal(nonHosteller.needsStay, null);
  assert.equal(calculateFees(nonHosteller).totalFee, null);

  assert.deepEqual(buildRegistrationSubmission({ ...nonHosteller, needsStay: true, stayType: 'NON_AC' }), {
    ...nonHosteller,
    needsStay: true,
    stayType: 'NON_AC',
    email: 'test@example.com',
    hostel: null,
  });
});

test('submission excludes all client-calculated authoritative prices', () => {
  const submission = buildRegistrationSubmission(valid);
  assert.equal('baseFee' in submission, false);
  assert.equal('stayFee' in submission, false);
  assert.equal('totalFee' in submission, false);
  assert.equal('paymentStatus' in submission, false);
});
