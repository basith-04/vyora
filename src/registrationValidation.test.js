import test from 'node:test';
import assert from 'node:assert/strict';
import { initialRegistration, normalizePhone, paymentProofError, validateRegistration } from './registrationValidation.js';

const valid = {
  ...initialRegistration,
  fullName: 'Test Participant',
  email: 'test@example.com',
  phone: '9876543210',
  year: 'third',
  ieeeMember: false,
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
  assert.equal(errors.workshop, 'SELECT ONE AIDEX WORKSHOP.');
  assert.equal(errors.paymentProof, 'UPLOAD YOUR PAYMENT SCREENSHOT.');
});

test('rejects unsupported or oversized payment proof', () => {
  assert.equal(paymentProofError({ name: 'payment.pdf', type: 'application/pdf', size: 1000 }), 'USE A JPG, PNG, OR WEBP IMAGE.');
  assert.equal(paymentProofError({ name: 'payment.jpg', type: 'image/jpeg', size: 6 * 1024 * 1024 }), 'IMAGE MUST BE 5 MB OR SMALLER.');
  assert.equal(paymentProofError(valid.paymentProof), '');
});
