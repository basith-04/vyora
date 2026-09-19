import assert from 'node:assert/strict';

const response = await fetch(
  'http://127.0.0.1:5001/demo-vyora-26/asia-south1/api/api/registrations',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Functions Emulator Participant',
      email: 'functions@example.com',
      phone: '9876543210',
      year: 2,
      ieeeMember: true,
      ieeeMembershipId: '12345678',
      isHosteller: false,
      hostel: null,
      needsStay: true,
      stayType: 'AC',
      workshopId: 'github-ai',
    }),
  },
);

const body = await response.json();
assert.equal(response.status, 201, JSON.stringify(body));
assert.equal(body.data.registrationStatus, 'PAYMENT_PENDING');
assert.equal(body.data.paymentStatus, 'PENDING');
assert.equal(body.data.workshopId, 'github-ai');
assert.deepEqual(body.data.pricing, { baseFee: 399, stayFee: 300, totalFee: 699 });
assert.match(body.data.registrationId, /^VYR26-/);
assert.ok(Date.parse(body.data.seatReservationExpiresAt));

console.log('Functions emulator registration smoke test passed.');
