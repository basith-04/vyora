export const checkpoints = Object.freeze([
  { type: 'EVENT', day: 1, label: 'Event Check-in', banner: 'EVENT CHECK-IN', action: 'Checked In', remaining: 'NOT YET CHECKED IN' },
  { type: 'DAY1_CHECK_OUT', day: 1, label: 'Day 1 Check-out', banner: 'DAY 1 CHECK-OUT', action: 'Checked Out', remaining: 'NOT YET CHECKED OUT', checkout: true },
  { type: 'WORKSHOP', day: 2, label: 'Workshop Check-in', banner: 'WORKSHOP CHECK-IN', action: 'Checked In', remaining: 'NOT YET CHECKED IN', workshop: true },
  { type: 'FIELD_TRIP_DEPARTURE', day: 2, label: 'Field Trip Departure', banner: 'FIELD TRIP — DEPARTURE FROM COLLEGE', action: 'Boarded', remaining: 'NOT YET BOARDED' },
  { type: 'FIELD_TRIP_RETURN', day: 2, label: 'Field Trip Return', banner: 'FIELD TRIP — RETURN TO COLLEGE', action: 'Boarded', remaining: 'NOT YET ACCOUNTED FOR' },
  { type: 'DAY2_CHECK_OUT', day: 2, label: 'Day 2 Check-out', banner: 'DAY 2 CHECK-OUT', action: 'Checked Out', remaining: 'NOT YET CHECKED OUT', checkout: true },
]);

export const accommodationGroups = Object.freeze([
  ['ALL', 'All'], ['SANJOSE', 'Sanjose'], ['SANTHOME', 'Santhome'],
  ['HOLY_CROSS', 'Holy Cross'], ['ALPHONSA', 'Alphonsa'],
  ['PG_HOUSE_NEAR_COLLEGE', 'PG / House Near College'], ['STAY', 'Stay'],
]);

export function groupLabel(value) {
  return accommodationGroups.find(([id]) => id === value)?.[1] || 'No assigned accommodation group';
}
