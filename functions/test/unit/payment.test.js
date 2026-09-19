import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { rupeesToPaise } from '../../src/services/checkout.js';
import { verifyCheckoutSignature, verifyWebhookSignature } from '../../src/services/signatures.js';

test('rupees are converted to paise exactly for every production total', () => {
  const totals = new Map([[399, 39900], [649, 64900], [699, 69900], [799, 79900], [1049, 104900], [1099, 109900]]);
  for (const [rupees, paise] of totals) assert.equal(rupeesToPaise(rupees), paise);
});

test('checkout signature accepts the expected order/payment pair only', () => {
  const secret = 'key-secret';
  const signature = createHmac('sha256', secret).update('order_1|pay_1').digest('hex');
  assert.equal(verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature, secret }), true);
  assert.equal(verifyCheckoutSignature({ orderId: 'order_wrong', paymentId: 'pay_1', signature, secret }), false);
  assert.equal(verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: '00'.repeat(32), secret }), false);
});

test('webhook signature is computed from the unmodified raw bytes', () => {
  const secret = 'webhook-secret';
  const rawBody = Buffer.from('{"a":1, "b":2}');
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
  assert.equal(verifyWebhookSignature({ rawBody, signature, secret }), true);
  assert.equal(verifyWebhookSignature({ rawBody: Buffer.from('{"a":1,"b":2}'), signature, secret }), false);
});
