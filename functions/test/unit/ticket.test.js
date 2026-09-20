import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTicketPayload, ticketPayloadForRegistration, ticketTokenHash,
} from '../../src/services/ticket.js';

test('ticket credential is stable, opaque and does not expose registration data', () => {
  const secret = 'a-secure-ticket-signing-secret-of-at-least-32-characters';
  const first = ticketPayloadForRegistration('internal-registration-doc', secret);
  const second = ticketPayloadForRegistration('internal-registration-doc', secret);
  assert.equal(first, second);
  assert.equal(isTicketPayload(first), true);
  assert.equal(first.includes('internal-registration-doc'), false);
  assert.equal(ticketTokenHash(first).length, 64);
});

test('malformed ticket payloads are rejected', () => {
  for (const value of [null, '', 'VYR26-123', 'vyora26:t:short', `vyora26:t:${'='.repeat(43)}`]) {
    assert.equal(isTicketPayload(value), false);
  }
});
