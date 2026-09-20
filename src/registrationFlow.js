export const FLOW_PHASE = Object.freeze({
  form: 'form',
  reserving: 'reserving',
  paymentPending: 'payment_pending',
  paymentFailed: 'payment_failed',
  verifying: 'verifying',
  verificationFailed: 'verification_failed',
  expired: 'expired',
  confirmed: 'confirmed',
  reconciliation: 'reconciliation',
  networkError: 'network_error',
});


export function isBusyPhase(phase) {
  return phase === FLOW_PHASE.reserving || phase === FLOW_PHASE.verifying;
}

export function phaseForApiError(error) {
  if (error?.code === 'RESERVATION_EXPIRED') return FLOW_PHASE.expired;
  if (error?.code === 'PAYMENT_REQUIRES_RECONCILIATION') return FLOW_PHASE.reconciliation;
  if (error?.code === 'PAYMENT_VERIFICATION_FAILED'
    || error?.code === 'PAYMENT_SIGNATURE_INVALID'
    || error?.code === 'PAYMENT_AMOUNT_MISMATCH') return FLOW_PHASE.verificationFailed;
  if (error?.code === 'NETWORK_ERROR') return FLOW_PHASE.networkError;
  return FLOW_PHASE.paymentFailed;
}

export function canRetryPayment(phase, remainingSeconds) {
  return remainingSeconds > 0 && [
    FLOW_PHASE.paymentPending,
    FLOW_PHASE.paymentFailed,
    FLOW_PHASE.verificationFailed,
    FLOW_PHASE.networkError,
  ].includes(phase);
}
