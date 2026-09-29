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

test('camera and request gate admits one scan until explicit re-arm, including after failure', async () => {
  const { createScanGate, canRetryCheckin } = await import('./checkinUi.js');
  const gate = createScanGate();
  let requests = 0;
  const detected = () => { if (gate.claim()) requests++; };
  for (let frame = 0; frame < 50; frame++) detected();
  assert.equal(requests, 1);
  // Finishing the request alone does not release the physical-scan gate.
  detected(); assert.equal(requests, 1);
  gate.rearm(); detected(); detected(); assert.equal(requests, 2);
  for (const code of ['NETWORK_ERROR', 'CHECKIN_TIMEOUT', 'INTERNAL_ERROR', 'INVALID_RESPONSE']) {
    assert.equal(checkinPresentation({ code }).kind, 'error');
    assert.equal(canRetryCheckin({ code }), true);
  }
  assert.equal(canRetryCheckin({ outcome: 'CHECKED_IN' }), false);
});
