import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFilters, filterRegistrations, readableStatus } from './adminData.js';
import { loginAdmin, logoutAdmin, observeAdmin } from './adminAuth.js';

const registrations = [
  { registrationId: 'VYR26-ALPHA', fullName: 'Alpha Person', email: 'alpha@example.com', phone: '9876500001', year: 1, ieeeMember: true, workshopId: 'data-science', isHosteller: true, hostel: 'SANJOSE', needsStay: false, stayType: null, paymentStatus: 'PAID', registrationStatus: 'CONFIRMED', paymentReconciliationRequired: false },
  { registrationId: 'VYR26-BETA', fullName: 'Beta Person', email: 'beta@example.com', phone: '9876500002', year: 3, ieeeMember: false, workshopId: 'github-ai', isHosteller: false, hostel: null, needsStay: true, stayType: 'AC', paymentStatus: 'PENDING', registrationStatus: 'PAYMENT_PENDING', paymentReconciliationRequired: true },
];

test('admin search covers registration ID, name, email and phone case-insensitively', () => {
  for (const search of ['alpha', 'PERSON', 'beta@example.com', '0002']) {
    assert.equal(filterRegistrations(registrations, search, defaultFilters).length, search === 'PERSON' ? 2 : 1);
  }
});

test('every important admin filter category and combined filtering works', () => {
  const cases = {
    registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', year: '1', ieee: 'true',
    workshopId: 'data-science', hosteller: 'true', hostel: 'SANJOSE', stay: 'false', reconciliation: 'false',
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
