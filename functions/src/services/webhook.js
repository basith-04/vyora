import { AppError } from '../errors.js';
import { verifyWebhookSignature } from './signatures.js';

const CAPTURE_EVENTS = new Set(['payment.captured', 'order.paid']);

export function createWebhookService({ paymentService, getWebhookSecret, logger = console }) {
  return async function handleWebhook({ rawBody, signature, eventId }) {
    if (!verifyWebhookSignature({ rawBody, signature, secret: getWebhookSecret() })) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'The webhook signature is invalid.', 400);
    }
    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new AppError('INVALID_JSON', 'The webhook body is not valid JSON.', 400);
    }
    if (typeof eventId !== 'string' || !eventId || typeof event?.event !== 'string') {
      throw new AppError('INVALID_WEBHOOK', 'The webhook is missing required metadata.', 400);
    }
    if (event.event === 'payment.failed') {
      const payment = event.payload?.payment?.entity;
      await paymentService.recordFailedWebhook({ payment, eventId });
      return { outcome: 'RECORDED' };
    }
    if (!CAPTURE_EVENTS.has(event.event)) return { outcome: 'IGNORED' };

    const payment = event.payload?.payment?.entity;
    const order = event.payload?.order?.entity;
    const paymentId = payment?.id;
    const orderId = payment?.order_id ?? order?.id;
    try {
      return await paymentService.processCapturedWebhook({ paymentId, orderId, eventId });
    } catch (error) {
      logger.error('Razorpay webhook reconciliation failed.', {
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        operation: 'webhook_reconcile',
        result: 'failed',
        code: error?.code,
      });
      throw error;
    }
  };
}
