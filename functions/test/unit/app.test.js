import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/errors.js';
import { createWebhookService } from '../../src/services/webhook.js';

const token = 'a'.repeat(43);

function services(overrides = {}) {
  return {
    checkoutService: {
      start: async () => ({
        registrationId: 'VYR26-ABCDEFGHIJKLMNOPQRST',
        registrationStatus: 'PAYMENT_PENDING',
        paymentStatus: 'PENDING',
        workshopId: 'github-ai',
        pricing: { baseFee: 399, stayFee: 0, totalFee: 399 },
        seatReservationExpiresAt: '2027-01-15T08:00:00.000Z',
        checkout: { keyId: 'rzp_test_public', orderId: 'order_test', amount: 39900, currency: 'INR' },
      }),
      retry: async () => ({}),
      status: async () => ({}),
      ...overrides.checkoutService,
    },
    paymentService: { verifyFromFrontend: async () => ({}), ...overrides.paymentService },
    webhookService: { handleWebhook: async () => ({ outcome: 'IGNORED' }), ...overrides.webhookService },
  };
}

test('registration endpoint returns participant-safe checkout fields', async () => {
  const app = createApp(services());
  const response = await request(app)
    .post('/api/registrations')
    .set('X-Registration-Token', token)
    .send({ participant: true });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.registrationId, 'VYR26-ABCDEFGHIJKLMNOPQRST');
  assert.equal(response.body.data.registrationDocId, undefined);
  assert.equal(response.body.data.checkout.amount, 39900);
});

test('registration endpoint requires an opaque recovery token', async () => {
  const app = createApp(services());
  const response = await request(app).post('/api/registrations').send({});
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_RECOVERY_TOKEN');
});

test('registration endpoint uses the consistent safe error envelope', async () => {
  const app = createApp(services({
    checkoutService: {
      start: async () => { throw new AppError('WORKSHOP_FULL', 'The selected workshop is full.', 409); },
    },
  }));
  const response = await request(app)
    .post('/api/registrations')
    .set('X-Registration-Token', token)
    .send({});
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: { code: 'WORKSHOP_FULL', message: 'The selected workshop is full.' },
  });
});

test('webhook route verifies the exact raw request body before JSON parsing', async () => {
  const secret = 'webhook-test-secret';
  let captured;
  const paymentService = {
    processCapturedWebhook: async (value) => { captured = value; return { outcome: 'CONFIRMED' }; },
    recordFailedWebhook: async () => ({ outcome: 'RECORDED' }),
  };
  const webhookService = createWebhookService({ paymentService, getWebhookSecret: () => secret });
  const app = createApp(services({ webhookService: { handleWebhook: webhookService } }));
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_123', order_id: 'order_123' } } },
  });
  const signature = createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
  const response = await request(app)
    .post('/api/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', signature)
    .set('X-Razorpay-Event-Id', 'event_123')
    .send(body);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.outcome, 'CONFIRMED');
  assert.deepEqual(captured, { paymentId: 'pay_123', orderId: 'order_123', eventId: 'event_123' });
});

test('webhook route rejects an invalid signature', async () => {
  const webhookService = createWebhookService({
    paymentService: {}, getWebhookSecret: () => 'secret', logger: { error() {} },
  });
  const app = createApp(services({ webhookService: { handleWebhook: webhookService } }));
  const response = await request(app)
    .post('/api/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', '00'.repeat(32))
    .set('X-Razorpay-Event-Id', 'event_bad')
    .send(JSON.stringify({ event: 'payment.captured' }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'WEBHOOK_SIGNATURE_INVALID');
});
