import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicRegistrationAvailability,
  REGISTRATION_CLOSED_LABEL,
} from './registrationAvailability.js';

test('public registration entry points are closed and have no registration link', () => {
  assert.equal(publicRegistrationAvailability.open, false);
  assert.equal(publicRegistrationAvailability.href, null);
  assert.equal(publicRegistrationAvailability.label, 'REGISTRATIONS CLOSED');
  assert.equal(REGISTRATION_CLOSED_LABEL, 'REGISTRATIONS CLOSED');
});
