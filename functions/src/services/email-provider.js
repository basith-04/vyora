import { configurationError } from '../errors.js';

export class EmailProviderError extends Error {
  constructor(code = 'EMAIL_PROVIDER_ERROR') {
    super('The email provider could not accept the message.');
    this.name = 'EmailProviderError';
    this.code = code;
  }
}

export function createResendEmailProvider({
  getApiKey,
  getFrom,
  fetchImpl = globalThis.fetch,
}) {
  return {
    async send({ to, subject, html, text, idempotencyKey }) {
      const apiKey = getApiKey();
      const from = getFrom();
      if (typeof apiKey !== 'string' || apiKey.length < 10) {
        throw configurationError('EMAIL_API_KEY is not configured.');
      }
      if (typeof from !== 'string' || !from.includes('@') || from.length > 200) {
        throw configurationError('EMAIL_FROM is not configured.');
      }
      let response;
      try {
        response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({ from, to: [to], subject, html, text }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new EmailProviderError('EMAIL_PROVIDER_UNAVAILABLE');
      }
      if (!response.ok) {
        throw new EmailProviderError(response.status === 429
          ? 'EMAIL_PROVIDER_RATE_LIMITED'
          : 'EMAIL_PROVIDER_REJECTED');
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new EmailProviderError('EMAIL_PROVIDER_INVALID_RESPONSE');
      }
      if (typeof payload?.id !== 'string' || payload.id.length < 3) {
        throw new EmailProviderError('EMAIL_PROVIDER_INVALID_RESPONSE');
      }
      return { providerMessageId: payload.id };
    },
  };
}
