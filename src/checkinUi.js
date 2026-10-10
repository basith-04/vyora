export function checkinPresentation(value) {
  const code = value?.outcome || value?.code || 'CHECKIN_FAILED';
  if (code === 'CHECKED_IN') return { kind: 'success', icon: '✓', title: 'CHECK-IN SUCCESSFUL' };
  if (code === 'ALREADY_CHECKED_IN') return { kind: 'warning', icon: '⚠', title: 'ALREADY CHECKED IN' };
  const messages = {
    WORKSHOP_MISMATCH: 'NOT REGISTERED FOR THIS WORKSHOP',
    ACCOMMODATION_GROUP_MISMATCH: 'WRONG ACCOMMODATION GROUP',
    ACCOMMODATION_GROUP_REQUIRED: 'SELECT ACCOMMODATION GROUP',
    INVALID_TICKET: 'INVALID TICKET',
    TICKET_REVOKED: 'TICKET REVOKED',
    REGISTRATION_NOT_CONFIRMED: 'REGISTRATION NOT CONFIRMED',
    REGISTRATION_NOT_FOUND: 'REGISTRATION NOT FOUND',
    WORKSHOP_REQUIRED: 'SELECT A WORKSHOP',
    WORKSHOP_CHECKIN_REQUIRED: 'WORKSHOP CHECK-IN REQUIRED',
    FIELD_TRIP_DEPARTURE_REQUIRED: 'FIELD TRIP DEPARTURE REQUIRED',
    DAY2_ATTENDANCE_REQUIRED: 'DAY 2 ATTENDANCE REQUIRED',
    INVALID_CHECKIN_TYPE: 'INVALID CHECK-IN MODE',
    INVALID_CHECKIN_REQUEST: 'INVALID CHECK-IN REQUEST',
    ADMIN_AUTH_REQUIRED: 'STAFF SESSION REQUIRED',
    ADMIN_TOKEN_INVALID: 'STAFF SESSION EXPIRED',
    ADMIN_ACCESS_DENIED: 'STAFF ACCESS DENIED',
    NETWORK_ERROR: 'NETWORK ERROR',
    CHECKIN_TIMEOUT: 'NETWORK TIMEOUT',
    INVALID_RESPONSE: 'CHECK-IN NOT CONFIRMED',
  };
  return { kind: 'error', icon: '✕', title: messages[code] || 'CHECK-IN FAILED' };
}

// Used by the camera callback and the parent request path. Only explicit re-arm releases it.
export function createScanGate() {
  let locked = false;
  return {
    claim() { if (locked) return false; locked = true; return true; },
    rearm() { locked = false; },
  };
}

export function canRetryCheckin(result) {
  return ['NETWORK_ERROR', 'CHECKIN_TIMEOUT', 'INTERNAL_ERROR', 'INVALID_RESPONSE', 'CHECKIN_FAILED'].includes(result?.code);
}
