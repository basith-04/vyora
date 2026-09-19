import test from 'node:test';
import assert from 'node:assert/strict';
import { openRazorpayCheckout } from './razorpayCheckout.js';

const checkout = {
  keyId: 'rzp_test_public', orderId: 'order_backend', amount: 69900, currency: 'INR',
  name: "VYORA '26", description: 'Registration',
  prefill: { name: 'Participant', email: 'p@example.com', contact: '9876543210' },
};

test('Checkout opens with the backend order and returns success for later verification', async () => {
  let receivedOptions;
  globalThis.Razorpay = class {
    constructor(options) { receivedOptions = options; }
    on() {}
    open() {
      receivedOptions.handler({
        razorpay_order_id: 'order_backend',
        razorpay_payment_id: 'pay_1',
        razorpay_signature: 'signature',
      });
    }
  };
  const result = await openRazorpayCheckout(checkout);
  assert.equal(receivedOptions.order_id, 'order_backend');
  assert.equal(receivedOptions.amount, 69900);
  assert.equal(result.type, 'success');
  assert.equal(result.response.razorpay_payment_id, 'pay_1');
  delete globalThis.Razorpay;
});

test('Checkout close returns pending rather than a false confirmation', async () => {
  let receivedOptions;
  globalThis.Razorpay = class {
    constructor(options) { receivedOptions = options; }
    on() {}
    open() { receivedOptions.modal.ondismiss(); }
  };
  const result = await openRazorpayCheckout(checkout);
  assert.deepEqual(result, { type: 'closed' });
  delete globalThis.Razorpay;
});

test('Checkout payment failure is a retryable failure result', async () => {
  let failedHandler;
  let receivedOptions;
  globalThis.Razorpay = class {
    constructor(options) { receivedOptions = options; }
    on(event, handler) { if (event === 'payment.failed') failedHandler = handler; }
    open() {
      failedHandler({ error: { code: 'BAD_REQUEST_ERROR' } });
      receivedOptions.modal.ondismiss();
    }
  };
  const result = await openRazorpayCheckout(checkout);
  assert.equal(result.type, 'failed');
  delete globalThis.Razorpay;
});
