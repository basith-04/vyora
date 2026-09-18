import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistrationSubmission, calculateFees, initialRegistration, normalizePhone, paymentProofError, updateRegistrationField, validateRegistration } from './registrationValidation.js';
import { hostels } from './registrationOptions.js';

const valid = {
  ...initialRegistration,
  fullName: 'Test Participant',
  email: 'test@example.com',
  phone: '9876543210',
  year: 'third',
  ieeeMember: false,
  isHosteller: false,
  needsStay: false,
  workshop: 'github-ai',
  paymentProof: { name: 'payment.png', type: 'image/png', size: 1024 },
};

test('normalizes Indian mobile numbers and country-code autofill', () => {
  assert.equal(normalizePhone('+91 98765-43210'), '9876543210');
  assert.equal(normalizePhone('09876543210'), '9876543210');
});

test('requires IEEE ID only for IEEE members', () => {
  assert.deepEqual(validateRegistration(valid), {});
  assert.equal(validateRegistration({ ...valid, ieeeMember: true }).ieeeId, 'IEEE MEMBERSHIP ID IS REQUIRED.');
  assert.deepEqual(validateRegistration({ ...valid, ieeeMember: true, ieeeId: ' 12345 ' }), {});
  assert.equal(validateRegistration({ ...valid, ieeeMember: null }).ieeeMember, 'SELECT YOUR IEEE STATUS.');
});

test('reports missing participant, workshop, and proof fields', () => {
  const errors = validateRegistration(initialRegistration);
  assert.equal(errors.fullName, 'ENTER YOUR FULL NAME.');
  assert.equal(errors.email, 'ENTER A VALID EMAIL ADDRESS.');
  assert.equal(errors.phone, 'ENTER A 10-DIGIT MOBILE NUMBER.');
  assert.equal(errors.year, 'SELECT YOUR YEAR OF STUDY.');
  assert.equal(errors.isHosteller, 'SELECT YOUR HOSTELLER STATUS.');
  assert.equal(errors.workshop, 'SELECT ONE AIDEX WORKSHOP.');
  assert.equal(errors.paymentProof, 'UPLOAD YOUR PAYMENT SCREENSHOT.');
});

test('calculates every IEEE and accommodation combination', () => {
  for (const hostel of hostels) {
    const ieeeHosteller = { ...valid, ieeeMember: true, ieeeId: '12345', isHosteller: true, hostel, needsStay: null };
    const nonIeeeHosteller = { ...ieeeHosteller, ieeeMember: false, ieeeId: '' };
    assert.deepEqual(validateRegistration(ieeeHosteller), {});
    assert.deepEqual(calculateFees(ieeeHosteller), { baseFee: 399, stayFee: 0, totalFee: 399 });
    assert.deepEqual(validateRegistration(nonIeeeHosteller), {});
    assert.deepEqual(calculateFees(nonIeeeHosteller), { baseFee: 799, stayFee: 0, totalFee: 799 });
  }
  for (const [ieeeMember, baseFee] of [[true, 399], [false, 799]]) {
    for (const needsStay of [false, true]) {
      const form = { ...valid, ieeeMember, ieeeId: ieeeMember ? '12345' : '', needsStay };
      assert.deepEqual(validateRegistration(form), {});
      assert.deepEqual(calculateFees(form), {
        baseFee,
        stayFee: needsStay ? 200 : 0,
        totalFee: baseFee + (needsStay ? 200 : 0),
      });
    }
  }
});

test('requires only the visible accommodation path and clears stale selections', () => {
  assert.equal(validateRegistration({ ...valid, isHosteller: false, needsStay: null }).needsStay, 'SELECT IF YOU NEED STAY.');
  assert.equal(validateRegistration({ ...valid, isHosteller: true, hostel: '' }).hostel, 'SELECT YOUR HOSTEL.');
  const hosteller = updateRegistrationField({ ...valid, needsStay: true }, 'isHosteller', true);
  assert.equal(hosteller.needsStay, null);
  assert.equal(calculateFees(hosteller).stayFee, 0);
  const nonHosteller = updateRegistrationField({ ...hosteller, hostel: 'Santhome' }, 'isHosteller', false);
  assert.equal(nonHosteller.hostel, '');
  assert.equal(nonHosteller.needsStay, null);
  assert.equal(calculateFees(nonHosteller).totalFee, null);
  assert.deepEqual(buildRegistrationSubmission({ ...nonHosteller, needsStay: true }), {
    ...nonHosteller, needsStay: true, hostel: null, baseFee: 799, stayFee: 200, totalFee: 999,
  });
});

test('rejects unsupported or oversized payment proof', () => {
  assert.equal(paymentProofError({ name: 'payment.pdf', type: 'application/pdf', size: 1000 }), 'USE A JPG, PNG, OR WEBP IMAGE.');
  assert.equal(paymentProofError({ name: 'payment.jpg', type: 'image/jpeg', size: 6 * 1024 * 1024 }), 'IMAGE MUST BE 5 MB OR SMALLER.');
  assert.equal(paymentProofError(valid.paymentProof), '');
});
