// Shared by the existing admin table and server-side CSV filter path.
export function matchesRegistrationFilters(item, search = '', filters = {}) {
  const needle = search.trim().toLocaleLowerCase();
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
  if (filters.gender && (filters.gender === 'NOT_PROVIDED' ? Boolean(item.gender) : item.gender !== filters.gender)) return false;
  if (filters.foodPreference && (filters.foodPreference === 'NOT_PROVIDED' ? Boolean(item.foodPreference) : item.foodPreference !== filters.foodPreference)) return false;
  if (filters.completionDetails && (filters.completionDetails === 'COMPLETED' ? !item.detailsCompletedAt : Boolean(item.detailsCompletedAt))) return false;
  return true;
}
