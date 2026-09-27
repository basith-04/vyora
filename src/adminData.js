import { matchesRegistrationFilters } from '../functions/shared/report-filters.js';
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
  eventCheckin: '', workshopCheckin: '', gender: '', foodPreference: '', completionDetails: '',
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
  return registrations.filter((item) => matchesRegistrationFilters(item, search, filters));
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
