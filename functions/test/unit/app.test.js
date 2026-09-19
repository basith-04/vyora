import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Timestamp } from 'firebase-admin/firestore';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/errors.js';

test('registration endpoint returns only participant-safe fields', async () => {
  const app = createApp({
    createRegistration: async () => ({
      registrationDocId: 'internal-id',
      registrationId: 'VYR26-PUBLIC',
      registrationStatus: 'PAYMENT_PENDING',
      paymentStatus: 'PENDING',
      workshopId: 'github-ai',
      pricing: { baseFee: 399, stayFee: 0, totalFee: 399 },
      seatReservationExpiresAt: Timestamp.fromMillis(1_800_000_000_000),
    }),
  });

  const response = await request(app).post('/api/registrations').send({ participant: true });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.registrationId, 'VYR26-PUBLIC');
  assert.equal(response.body.data.registrationDocId, undefined);
  assert.equal(response.body.data.seatReservationExpiresAt, '2027-01-15T08:00:00.000Z');
});

test('registration endpoint uses the consistent safe error envelope', async () => {
  const app = createApp({
    createRegistration: async () => {
      throw new AppError('WORKSHOP_FULL', 'The selected workshop is full.', 409);
    },
  });
  const response = await request(app).post('/api/registrations').send({});
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: { code: 'WORKSHOP_FULL', message: 'The selected workshop is full.' },
  });
});
