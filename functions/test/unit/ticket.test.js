import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTicketPayload, isTicketViewToken, ticketPayloadForRegistration,
  ticketTokenHash, ticketViewTokenForRegistration,
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

test('ticket-view credential is stable, opaque, and domain-separated from the QR credential', () => {
  const secret = 'a-secure-ticket-signing-secret-of-at-least-32-characters';
  const view = ticketViewTokenForRegistration('internal-registration-doc', secret);
  const qr = ticketPayloadForRegistration('internal-registration-doc', secret);
  assert.equal(isTicketViewToken(view), true);
  assert.notEqual(view, qr);
  assert.equal(view.includes('internal-registration-doc'), false);
  assert.equal(ticketTokenHash(view).length, 64);
});

test('malformed ticket payloads are rejected', () => {
  for (const value of [null, '', 'VYR26-123', 'vyora26:t:short', `vyora26:t:${'='.repeat(43)}`]) {
    assert.equal(isTicketPayload(value), false);
    assert.equal(isTicketViewToken(value), false);
  }
});
