import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqualHex(expected, supplied) {
  if (typeof supplied !== 'string' || !/^[a-f0-9]+$/i.test(supplied)) return false;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function verifyCheckoutSignature({ orderId, paymentId, signature, secret }) {
  if (![orderId, paymentId, secret].every((value) => typeof value === 'string' && value)) {
    return false;
  }
  const expected = createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`, 'utf8')
    .digest('hex');
  return safeEqualHex(expected, signature);
}

export function verifyWebhookSignature({ rawBody, signature, secret }) {
  if (!Buffer.isBuffer(rawBody) || typeof secret !== 'string' || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
