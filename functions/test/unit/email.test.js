import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationEmailContent, escapeHtml } from '../../src/services/email-template.js';
import { createResendEmailProvider } from '../../src/services/email-provider.js';

const registration = {
  fullName: '<Participant & Friend>',
  registrationId: 'VYR26-ABCDEFGHIJKLMNOPQRST',
  email: 'participant@example.com',
  ieeeMember: true,
  workshopId: 'github-ai',
  isHosteller: false,
  needsStay: true,
  stayType: 'AC',
};

test('confirmation email escapes participant content and links only the ticket-view credential', () => {
  const token = `vyora26:v:${'A'.repeat(43)}`;
  const result = confirmationEmailContent({ registration, ticketViewToken: token, baseUrl: 'https://vyora.example/' });
  assert.match(result.html, /Registration confirmed/);
  assert.match(result.html, /&lt;Participant &amp; Friend&gt;/);
  assert.doesNotMatch(result.html, /<Participant & Friend>/);
  assert.match(result.ticketUrl, /^https:\/\/vyora\.example\/ticket#ticket=/);
  assert.match(result.text, /09–10 October 2026/);
  assert.equal(result.html.includes('razorpay'), false);
  assert.equal(escapeHtml('"<>&\''), '&quot;&lt;&gt;&amp;&#39;');
});

test('confirmation email refuses non-HTTPS production links', () => {
  assert.throws(
    () => confirmationEmailContent({ registration, ticketViewToken: 'opaque', baseUrl: 'http://vyora.example' }),
    /PUBLIC_BASE_URL_INVALID/,
  );
});

test('confirmation email displays the PG/House Near College label', () => {
  const result = confirmationEmailContent({
    registration: {
      ...registration,
      isHosteller: true,
      hostel: 'PG_HOUSE_NEAR_COLLEGE',
      needsStay: false,
      stayType: null,
    },
    ticketViewToken: `vyora26:v:${'A'.repeat(43)}`,
    baseUrl: 'https://vyora.example/',
  });
  assert.match(result.text, /Existing hosteller — PG\/House Near College/);
});

test('Resend provider sends a fixed payload with a provider idempotency key', async () => {
  let request;
  const provider = createResendEmailProvider({
    getApiKey: () => 're_test_key_value',
    getFrom: () => "VYORA '26 <tickets@vyora.example>",
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ id: 'email_123' }) }; },
  });
  const result = await provider.send({
    to: 'participant@example.com', subject: 'Confirmed', html: '<p>ok</p>', text: 'ok',
    idempotencyKey: 'vyora26-confirmation/internal-doc',
  });
  assert.equal(result.providerMessageId, 'email_123');
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers['Idempotency-Key'], 'vyora26-confirmation/internal-doc');
  assert.equal(JSON.parse(request.options.body).to[0], 'participant@example.com');
});
