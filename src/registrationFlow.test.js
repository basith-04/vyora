import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRetryPayment,
  FLOW_PHASE,
  isBusyPhase,
  phaseForApiError,
} from './registrationFlow.js';

test('submission and backend verification phases are guarded as busy', () => {
  assert.equal(isBusyPhase(FLOW_PHASE.reserving), true);
  assert.equal(isBusyPhase(FLOW_PHASE.verifying), true);
  assert.equal(isBusyPhase(FLOW_PHASE.paymentPending), false);
});

test('Checkout close/failure paths remain retryable only before expiry', () => {
  assert.equal(canRetryPayment(FLOW_PHASE.paymentPending, 60), true);
  assert.equal(canRetryPayment(FLOW_PHASE.paymentFailed, 60), true);
  assert.equal(canRetryPayment(FLOW_PHASE.verificationFailed, 60), true);
  assert.equal(canRetryPayment(FLOW_PHASE.paymentFailed, 0), false);
  assert.equal(canRetryPayment(FLOW_PHASE.confirmed, 60), false);
});

test('server errors map to distinct participant-facing states', () => {
  assert.equal(phaseForApiError({ code: 'RESERVATION_EXPIRED' }), FLOW_PHASE.expired);
  assert.equal(phaseForApiError({ code: 'PAYMENT_SIGNATURE_INVALID' }), FLOW_PHASE.verificationFailed);
  assert.equal(phaseForApiError({ code: 'PAYMENT_REQUIRES_RECONCILIATION' }), FLOW_PHASE.reconciliation);
  assert.equal(phaseForApiError({ code: 'NETWORK_ERROR' }), FLOW_PHASE.networkError);
});
