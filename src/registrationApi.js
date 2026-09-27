export class RegistrationApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'RegistrationApiError';
    this.code = code;
    this.status = status;
  }
}

export function createRecoveryToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

async function apiRequest(path, body, token, raw = false) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Registration-Token': token } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new RegistrationApiError('NETWORK_ERROR', 'The server could not be reached. Check your connection and try again.', 0);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new RegistrationApiError('INVALID_RESPONSE', 'The server returned an invalid response.', response.status);
  }
  if (raw) return payload;
  if (!response.ok) {
    throw new RegistrationApiError(
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? 'The request could not be completed.',
      response.status,
    );
  }
  return payload.data;
}

export const registrationApi = {
  complete: (values) => apiRequest('/api/complete-registration', values, undefined, true),
  create: (participant, token) => apiRequest('/api/registrations', participant, token),
  retry: (registrationId, token) => apiRequest('/api/registrations/retry', { registrationId }, token),
  status: (registrationId, token) => apiRequest('/api/registrations/status', { registrationId }, token),
  verify: (payment, token) => apiRequest('/api/payments/verify', payment, token),
  ticket: (registrationId, token) => apiRequest('/api/registrations/ticket', { registrationId }, token),
  viewTicket: (ticketViewToken) => apiRequest('/api/tickets/view', { ticketViewToken }),
};
