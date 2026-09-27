export const workshopLabels = Object.freeze({
  'data-science': 'Data Science and Analytics using Python',
  'ai-ml-data': 'AI / ML / Data',
  'github-ai': 'GitHub × AI',
});

export const hostelLabels = Object.freeze({
  SANJOSE: 'Sanjose', SANTHOME: 'Santhome', HOLY_CROSS: 'Holy Cross', ALPHONSA: 'Alphonsa',
  PG_HOUSE_NEAR_COLLEGE: 'PG/House Near College',
});

export const defaultFilters = Object.freeze({
  registrationStatus: '', paymentStatus: '', year: '', ieee: '', workshopId: '',
  hosteller: '', hostel: '', stay: '', stayType: '', reconciliation: '',
  eventCheckin: '', workshopCheckin: '',
});

export function readableStatus(value) {
  return value ? value.replaceAll('_', ' ') : '—';
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString('en-IN', {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

export function filterRegistrations(registrations, search, filters) {
  const needle = search.trim().toLocaleLowerCase();
  return registrations.filter((item) => {
    if (needle && ![item.registrationId, item.fullName, item.email, item.phone, item.department, item.class]
      .some((value) => String(value || '').toLocaleLowerCase().includes(needle))) return false;
    if (filters.registrationStatus && item.registrationStatus !== filters.registrationStatus) return false;
    if (filters.paymentStatus && item.paymentStatus !== filters.paymentStatus) return false;
    if (filters.year && String(item.year) !== filters.year) return false;
    if (filters.ieee && String(item.ieeeMember) !== filters.ieee) return false;
    if (filters.workshopId && item.workshopId !== filters.workshopId) return false;
    if (filters.hosteller && String(item.isHosteller) !== filters.hosteller) return false;
    if (filters.hostel && item.hostel !== filters.hostel) return false;
    if (filters.stay && String(item.needsStay) !== filters.stay) return false;
    if (filters.stayType && item.stayType !== filters.stayType) return false;
    if (filters.reconciliation && String(item.paymentReconciliationRequired) !== filters.reconciliation) return false;
    if (filters.eventCheckin && String(Boolean(item.attendance?.event)) !== filters.eventCheckin) return false;
    if (filters.workshopCheckin && String(Boolean(item.attendance?.workshop)) !== filters.workshopCheckin) return false;
    return true;
  });
}

export function confirmedParticipantMatches(registrations, search) {
  if (!search.trim()) return [];
  const needle = search.trim().toLocaleLowerCase();
  return filterRegistrations(registrations, search, defaultFilters)
    .filter((item) => item.registrationStatus === 'CONFIRMED' && item.paymentStatus === 'PAID')
    .sort((a, b) => Number(b.fullName.toLocaleLowerCase().includes(needle))
      - Number(a.fullName.toLocaleLowerCase().includes(needle)));
}

export function canAccessAdminView(role, view) {
  return !['tickets', 'edit-ticket', 'transfer-ticket', 'reconciliation', 'manual-ticket', 'ticket-email-resender'].includes(view) || role === 'ADMIN';
}
