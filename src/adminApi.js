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
  const token = await user.getIdToken(forceRefresh);
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
export const loadRegistrations = (auth) => adminRequest(auth, '/api/admin/registrations');
export const loadRegistration = (auth, id) => adminRequest(auth, `/api/admin/registrations/${encodeURIComponent(id)}`);
export function downloadRegistrationsCsv(auth, search = '', filters = {}) {
  const query = new URLSearchParams();
  if (search.trim()) query.set('search', search.trim());
  for (const [name, value] of Object.entries(filters)) {
    if (value) query.set(name, value);
  }
  const suffix = query.size ? `?${query.toString()}` : '';
  return adminRequest(auth, `/api/admin/export/registrations.csv${suffix}`, { responseType: 'blob' });
}
export const submitCheckin = (auth, input) => adminRequest(auth, '/api/admin/check-ins', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
});
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
