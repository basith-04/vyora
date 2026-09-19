export class AdminApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
    this.status = status;
  }
}

async function authorizedFetch(auth, path, options = {}, forceRefresh = false) {
  const user = auth.currentUser;
  if (!user) throw new AdminApiError('ADMIN_AUTH_REQUIRED', 'Your staff session has ended.', 401);
  const token = await user.getIdToken(forceRefresh);
  return fetch(path, {
    ...options,
    headers: {
      Accept: options.responseType === 'blob' ? 'text/csv' : 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
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
  );
}

export const loadAdminProfile = (auth) => adminRequest(auth, '/api/admin/me');
export const loadDashboard = (auth) => adminRequest(auth, '/api/admin/dashboard');
export const loadRegistrations = (auth) => adminRequest(auth, '/api/admin/registrations');
export const loadRegistration = (auth, id) => adminRequest(auth, `/api/admin/registrations/${encodeURIComponent(id)}`);
export const downloadRegistrationsCsv = (auth) => adminRequest(auth, '/api/admin/export/registrations.csv', { responseType: 'blob' });
