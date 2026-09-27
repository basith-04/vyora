// Safe export column metadata shared with the selector. Values are mapped server-side.
export const CSV_FIELDS = Object.freeze([
  { key: 'fullName', label: 'Name', group: 'Participant', defaultSelected: true },
  { key: 'email', label: 'Email', group: 'Participant', defaultSelected: true },
  { key: 'phone', label: 'Phone', group: 'Participant', defaultSelected: true },
  { key: 'year', label: 'Year', group: 'Participant', defaultSelected: true },
  { key: 'department', label: 'Department', group: 'Participant' },
  { key: 'class', label: 'Class', group: 'Participant' },
  { key: 'ieeeMember', label: 'IEEE Member', group: 'Participant' },
  { key: 'ieeeMembershipId', label: 'IEEE ID', group: 'Participant' },
  { key: 'workshop', label: 'Workshop', group: 'Event', defaultSelected: true },
  { key: 'registrationId', label: 'Registration ID', group: 'Event' },
  { key: 'registrationStatus', label: 'Registration Status', group: 'Event' },
  { key: 'paymentStatus', label: 'Payment Status', group: 'Event' },
  { key: 'isHosteller', label: 'Hosteller', group: 'Accommodation' },
  { key: 'hostel', label: 'Hostel', group: 'Accommodation' },
  { key: 'needsStay', label: 'Needs Stay', group: 'Accommodation' },
  { key: 'stayType', label: 'Stay Type', group: 'Accommodation' },
  { key: 'gender', label: 'Gender', group: 'Preferences' },
  { key: 'foodPreference', label: 'Food Preference', group: 'Preferences' },
  { key: 'detailsCompleted', label: 'Completion Details', group: 'Preferences' },
  { key: 'baseFee', label: 'Base Fee', group: 'Payment' },
  { key: 'stayFee', label: 'Stay Fee', group: 'Payment' },
  { key: 'totalFee', label: 'Total Fee', group: 'Payment' },
  { key: 'paymentReconciliationRequired', label: 'Payment Reconciliation', group: 'Payment' },
  { key: 'createdAt', label: 'Created At', group: 'Timeline' },
  { key: 'confirmedAt', label: 'Confirmed At', group: 'Timeline' },
  { key: 'expiredAt', label: 'Expired At', group: 'Timeline' },
  { key: 'eventCheckedInAt', label: 'Event Checked In At', group: 'Attendance' },
  { key: 'workshopCheckedInAt', label: 'Workshop Checked In At', group: 'Attendance' },
]);
export const DEFAULT_CSV_COLUMNS = Object.freeze(CSV_FIELDS.filter((field) => field.defaultSelected).map((field) => field.key));
export const ALL_CSV_COLUMNS = Object.freeze(CSV_FIELDS.map((field) => field.key));
export function toggleCsvColumn(selected, key) {
  if (!ALL_CSV_COLUMNS.includes(key)) return selected;
  return selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key];
}
export function allCsvColumnsSelected(selected) {
  return ALL_CSV_COLUMNS.every((key) => selected.includes(key));
}
