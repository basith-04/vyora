import test from 'node:test';
import assert from 'node:assert/strict';
import { checkinPresentation } from './checkinUi.js';

test('check-in outcomes map to explicit accessible result labels', () => {
  assert.deepEqual(checkinPresentation({ outcome: 'CHECKED_IN' }), { kind: 'success', icon: '✓', title: 'CHECK-IN SUCCESSFUL' });
  assert.equal(checkinPresentation({ outcome: 'ALREADY_CHECKED_IN' }).title, 'ALREADY CHECKED IN');
  assert.equal(checkinPresentation({ code: 'WORKSHOP_MISMATCH' }).title, 'NOT REGISTERED FOR THIS WORKSHOP');
  assert.equal(checkinPresentation({ code: 'TICKET_REVOKED' }).title, 'TICKET REVOKED');
  assert.equal(checkinPresentation({ code: 'NETWORK_ERROR' }).title, 'NETWORK ERROR');
});
