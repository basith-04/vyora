import assert from 'node:assert/strict';

const response = await fetch(
  'http://127.0.0.1:5001/demo-vyora-26/asia-south1/api/api/registrations',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  },
);

const body = await response.json();
assert.equal(response.status, 400, JSON.stringify(body));
assert.equal(body.error.code, 'INVALID_RECOVERY_TOKEN');

const adminResponse = await fetch(
  'http://127.0.0.1:5001/demo-vyora-26/asia-south1/api/api/admin/registrations',
);
const adminBody = await adminResponse.json();
assert.equal(adminResponse.status, 401, JSON.stringify(adminBody));
assert.equal(adminBody.error.code, 'ADMIN_AUTH_REQUIRED');

console.log('Functions emulator public and protected routing/error smoke tests passed.');
