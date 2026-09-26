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

test('credential revision preserves original credentials and gives both transfer credentials new opaque values', () => {
  const secret = 'a-secure-ticket-signing-secret-of-at-least-32-characters';
  const id = 'internal-registration-doc';
  assert.equal(ticketPayloadForRegistration(id, secret, 0), ticketPayloadForRegistration(id, secret));
  assert.equal(ticketViewTokenForRegistration(id, secret, 0), ticketViewTokenForRegistration(id, secret));
  const newQr = ticketPayloadForRegistration(id, secret, 1);
  const newView = ticketViewTokenForRegistration(id, secret, 1);
  assert.notEqual(newQr, ticketPayloadForRegistration(id, secret));
  assert.notEqual(newView, ticketViewTokenForRegistration(id, secret));
  assert.equal(isTicketPayload(newQr), true);
  assert.equal(isTicketViewToken(newView), true);
});

test('malformed ticket payloads are rejected', () => {
  for (const value of [null, '', 'VYR26-123', 'vyora26:t:short', `vyora26:t:${'='.repeat(43)}`]) {
    assert.equal(isTicketPayload(value), false);
    assert.equal(isTicketViewToken(value), false);
  }
});
