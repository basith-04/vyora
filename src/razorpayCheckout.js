const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
let checkoutScriptPromise;

export function loadRazorpayCheckout() {
  if (globalThis.Razorpay) return Promise.resolve();
  if (checkoutScriptPromise) return checkoutScriptPromise;
  checkoutScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CHECKOUT_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => {
      script.remove();
      checkoutScriptPromise = undefined;
      reject(new Error('Razorpay Checkout could not be loaded.'));
    }, { once: true });
    if (!existing) {
      script.src = CHECKOUT_SCRIPT;
      script.async = true;
      document.head.append(script);
    }
  });
  return checkoutScriptPromise;
}

export async function openRazorpayCheckout(checkout) {
  await loadRazorpayCheckout();
  return new Promise((resolve) => {
    let settled = false;
    let paymentFailure = null;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const instance = new globalThis.Razorpay({
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amount,
      currency: checkout.currency,
      name: checkout.name,
      description: checkout.description,
      prefill: checkout.prefill,
      theme: { color: '#ff4d00' },
      retry: { enabled: true },
      handler: (response) => finish({ type: 'success', response }),
      modal: {
        ondismiss: () => finish(paymentFailure
          ? { type: 'failed', response: paymentFailure }
          : { type: 'closed' }),
      },
    });
    // Checkout can let the participant retry after a failed attempt. Keep the
    // callback live so a subsequent success can still be verified.
    instance.on('payment.failed', (response) => { paymentFailure = response; });
    instance.open();
  });
}
