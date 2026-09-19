export const COLLECTIONS = Object.freeze({
  registrations: 'registrations',
  workshops: 'workshops',
  system: 'system',
  registrationLocks: 'registrationLocks',
  payments: 'payments',
  admins: 'admins',
});

export const SYSTEM_DOCUMENTS = Object.freeze({
  capacity: 'capacity',
  registrationConfig: 'registration-config',
});

export const WORKSHOP_IDS = Object.freeze([
  'data-science',
  'ai-ml-data',
  'github-ai',
]);

export const HOSTELS = Object.freeze([
  'SANJOSE',
  'SANTHOME',
  'HOLY_CROSS',
  'ALPHONSA',
]);

export const STAY_TYPES = Object.freeze(['AC', 'NON_AC']);
export const YEARS = Object.freeze([1, 2, 3, 4]);

export const REGISTRATION_STATUS = Object.freeze({
  paymentPending: 'PAYMENT_PENDING',
  confirmed: 'CONFIRMED',
  expired: 'EXPIRED',
});

export const PAYMENT_STATUS = Object.freeze({
  pending: 'PENDING',
  paid: 'PAID',
});

export const ORDER_CREATION_STATUS = Object.freeze({
  creating: 'CREATING',
  ready: 'READY',
  failed: 'FAILED',
});

export const DEFAULT_CONFIGURATION = Object.freeze({
  capacity: {
    eventCapacity: 165,
    eventOccupied: 0,
    firstYearCapacity: 55,
    firstYearOccupied: 0,
  },
  registration: {
    registrationOpen: true,
    pricing: {
      ieee: 399,
      nonIeee: 799,
      accommodation: {
        nonAc: 250,
        ac: 300,
      },
    },
    reservationDurationSeconds: 300,
  },
  workshops: {
    'data-science': {
      id: 'data-science',
      name: 'Data Science and Analytics using Python',
      capacity: 55,
      occupied: 0,
      active: true,
    },
    'ai-ml-data': {
      id: 'ai-ml-data',
      name: 'AI / ML / Data',
      capacity: 55,
      occupied: 0,
      active: true,
    },
    'github-ai': {
      id: 'github-ai',
      name: 'GitHub × AI',
      capacity: 55,
      occupied: 0,
      active: true,
    },
  },
});
