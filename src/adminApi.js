export class AdminApiError extends Error {
  constructor(code, message, status, details = undefined) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function authorizedFetch(auth, path, options = {}, forceRefresh = false) {
  const user = auth.currentUser;
  if (!user) throw new AdminApiError('ADMIN_AUTH_REQUIRED', 'Your staff session has ended.', 401);
  options.signal?.throwIfAborted();
  const token = await user.getIdToken(forceRefresh);
  options.signal?.throwIfAborted();
  try {
    return await fetch(path, {
      ...options,
      headers: {
        Accept: options.responseType === 'blob' ? 'text/csv' : 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  } catch {
    throw new AdminApiError('NETWORK_ERROR', 'The server could not be reached. Check the connection and try again.', 0);
  }
}

export async function adminRequest(auth, path, options = {}) {
  let response = await authorizedFetch(auth, path, options);
  if (response.status === 401) response = await authorizedFetch(auth, path, options, true);
  if (response.ok) {
    if (options.responseType === 'blob') return response.blob();
    return (await response.json()).data;
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  throw new AdminApiError(
    payload?.error?.code || 'ADMIN_API_ERROR',
    payload?.error?.message || 'The admin request could not be completed.',
    response.status,
    payload?.error?.details,
  );
}

export const loadAdminProfile = (auth) => adminRequest(auth, '/api/admin/me');
export const loadDashboard = (auth) => adminRequest(auth, '/api/admin/dashboard');
export const loadTickets = (auth) => adminRequest(auth, '/api/admin/tickets');
export const createManualTicket = (auth, input) => adminRequest(auth, '/api/admin/manual-tickets', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
});
export const loadTicketEdit = (auth, id) => adminRequest(auth, `/api/admin/edit-ticket/${encodeURIComponent(id)}`);
export const saveTicketEdit = (auth, id, input) => adminRequest(auth, `/api/admin/edit-ticket/${encodeURIComponent(id)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
});
export const loadTicketTransfer = (auth, id) => adminRequest(auth, `/api/admin/transfer-ticket/${encodeURIComponent(id)}`);
export const submitTicketTransfer = (auth, id, input) => adminRequest(auth, `/api/admin/transfer-ticket/${encodeURIComponent(id)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
});
export const loadRegistrations = (auth) => adminRequest(auth, '/api/admin/registrations');
export const searchAttendanceParticipants = (auth, search, options = {}) => adminRequest(auth,
  `/api/admin/check-ins/participants?${new URLSearchParams({ search })}`, options);
export const loadAttendanceSummary = (auth, selection) => adminRequest(auth, `/api/admin/check-ins/summary?${new URLSearchParams(selection)}`);
export const loadRegistration = (auth, id) => adminRequest(auth, `/api/admin/registrations/${encodeURIComponent(id)}`);
export function downloadRegistrationsCsv(auth, search = '', filters = {}, columns) {
  const query = new URLSearchParams();
  if (search.trim()) query.set('search', search.trim());
  for (const [name, value] of Object.entries(filters)) {
    if (value) query.set(name, value);
  }
  if (columns !== undefined) query.set('columns', columns.join(','));
  const suffix = query.size ? `?${query.toString()}` : '';
  return adminRequest(auth, `/api/admin/export/registrations.csv${suffix}`, { responseType: 'blob' });
}
export async function submitCheckin(auth, input, { timeoutMs = 20_000 } = {}) {
  const subject = input.registrationDocId ? 'participant' : 'ticket';
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AdminApiError('CHECKIN_TIMEOUT', `The request timed out. Check-in may have been recorded. Retry this ${subject} to confirm.`, 0));
      controller.abort();
    }, timeoutMs);
  });
  try {
    const data = await Promise.race([adminRequest(auth, '/api/admin/check-ins', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: controller.signal,
    }), deadline]);
    if (!['CHECKED_IN', 'ALREADY_CHECKED_IN'].includes(data?.outcome)) {
      throw new AdminApiError('INVALID_RESPONSE', `Check-in could not be confirmed. Retry this ${subject}.`, 0);
    }
    return data;
  } catch (error) {
    if (error.code === 'NETWORK_ERROR') error.message = `Connection lost. Check-in may have been recorded. Retry this ${subject} to confirm.`;
    if (!error.code) throw new AdminApiError('INVALID_RESPONSE', `Check-in could not be confirmed. Retry this ${subject}.`, 0);
    throw error;
  } finally { clearTimeout(timer); }
}
export const retryConfirmationEmail = (auth, registrationId) => adminRequest(
  auth,
  `/api/admin/registrations/${encodeURIComponent(registrationId)}/confirmation-email/retry`,
  { method: 'POST' },
);
export const reconcilePayment = (auth, registrationId) => adminRequest(
  auth,
  `/api/admin/registrations/${encodeURIComponent(registrationId)}/reconcile-payment`,
  { method: 'POST' },
);

export const loadTicketEmail = (auth, id) => adminRequest(auth, `/api/admin/registrations/${encodeURIComponent(id)}/ticket-email`);
export const resendTicketEmail = (auth, id, requestId) => adminRequest(auth, `/api/admin/registrations/${encodeURIComponent(id)}/ticket-email/resend`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }),
});
