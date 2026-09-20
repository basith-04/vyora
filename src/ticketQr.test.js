import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTicketQr } from './ticketQr.js';

test('stable ticket payload renders a reusable PNG data URL', async () => {
  const payload = `vyora26:t:${'A'.repeat(43)}`;
  const first = await renderTicketQr(payload);
  const second = await renderTicketQr(payload);
  assert.match(first, /^data:image\/png;base64,/);
  assert.equal(first, second);
});

test('ticket QR renderer rejects malformed credentials', async () => {
  assert.throws(() => renderTicketQr('VYR26-PREDICTABLE-ID'), /invalid/i);
});
