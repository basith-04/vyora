import { matchesRegistrationFilters } from '../../shared/report-filters.js';
import { CSV_FIELDS, DEFAULT_CSV_COLUMNS } from '../../shared/csv-fields.js';
import { AppError } from '../errors.js';
import { COLLECTIONS, SYSTEM_DOCUMENTS, WORKSHOP_IDS } from '../config/constants.js';
import { createCsv } from '../utils/csv.js';

const REGISTRATION_STATES = ['PAYMENT_PENDING', 'CONFIRMED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED'];
const PAYMENT_STATES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'];
const YEAR_VALUES = [1, 2, 3, 4];
const HOSTELS = ['SANJOSE', 'SANTHOME', 'HOLY_CROSS', 'ALPHONSA', 'PG_HOUSE_NEAR_COLLEGE'];
const WORKSHOP_NAMES = {
  'data-science': 'Data Science and Analytics using Python',
  'ai-ml-data': 'AI / ML / Data',
  'github-ai': 'GitHub × AI',
};

const EXPORT_FILTER_VALUES = Object.freeze({
  registrationStatus: new Set(REGISTRATION_STATES),
  paymentStatus: new Set(PAYMENT_STATES),
  year: new Set(YEAR_VALUES.map(String)),
  ieee: new Set(['true', 'false']),
  workshopId: new Set(WORKSHOP_IDS),
  hosteller: new Set(['true', 'false']),
  hostel: new Set(HOSTELS),
  stay: new Set(['true', 'false']),
  stayType: new Set(['AC', 'NON_AC']),
  reconciliation: new Set(['true', 'false']),
  eventCheckin: new Set(['true', 'false']),
  workshopCheckin: new Set(['true', 'false']),
  gender: new Set(['MALE', 'FEMALE', 'NOT_PROVIDED']),
  foodPreference: new Set(['VEG', 'NON_VEG', 'NOT_PROVIDED']),
  completionDetails: new Set(['COMPLETED', 'NOT_COMPLETED']),
});

export function normalizeExportFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('INVALID_ADMIN_FILTERS', 'CSV export filters are invalid.', 400);
  }
  const allowed = new Set(['search', ...Object.keys(EXPORT_FILTER_VALUES)]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new AppError('INVALID_ADMIN_FILTERS', 'CSV export filters are invalid.', 400);
  }
  const result = { search: '' };
  for (const [key, rawValue] of Object.entries(input)) {
    if (Array.isArray(rawValue) || (typeof rawValue !== 'string' && rawValue != null)) {
      throw new AppError('INVALID_ADMIN_FILTERS', 'CSV export filters are invalid.', 400);
    }
    const value = String(rawValue || '').trim();
    if (!value) continue;
    if (key === 'search') {
      if (value.length > 200) throw new AppError('INVALID_ADMIN_FILTERS', 'CSV export search is too long.', 400);
      result.search = value;
    } else if (!EXPORT_FILTER_VALUES[key].has(value)) {
      throw new AppError('INVALID_ADMIN_FILTERS', 'CSV export filters are invalid.', 400);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function filterRegistrationsForExport(registrations, input = {}) {
  const filters = normalizeExportFilters(input);
  return registrations.filter((item) => matchesRegistrationFilters(item, filters.search, filters));
}

function iso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

function counters(keys) {
  return Object.fromEntries(keys.map((key) => [String(key), 0]));
}

function increment(target, value) {
  if (value == null) return;
  const key = String(value);
  target[key] = (target[key] || 0) + 1;
}

function publicPayment(payment) {
  if (!payment) return null;
  return {
    razorpayOrderId: payment.razorpayOrderId || null,
    razorpayPaymentId: payment.razorpayPaymentId || null,
    amount: Number.isFinite(payment.amount) ? payment.amount : null,
    currency: payment.currency || null,
    status: payment.status || null,
    reconciliationRequired: payment.reconciliationRequired === true,
    reconciliationReason: payment.reconciliationReason || null,
    createdAt: iso(payment.createdAt),
    verifiedAt: iso(payment.verifiedAt),
    updatedAt: iso(payment.updatedAt),
  };
}

function publicCheckin(checkin, adminNames = new Map()) {
  if (!checkin) return null;
  return {
    type: checkin.type,
    workshopId: checkin.workshopId || null,
    checkedInAt: iso(checkin.checkedInAt),
    checkedInBy: checkin.checkedInBy,
    checkedInByName: adminNames.get(checkin.checkedInBy) || null,
  };
}

function publicConfirmationEmail(value) {
  return {
    status: value?.status || 'PENDING',
    attempts: Number.isInteger(value?.attempts) ? value.attempts : 0,
    sentAt: iso(value?.sentAt),
    lastAttemptAt: iso(value?.lastAttemptAt),
    lastErrorCode: value?.lastErrorCode || null,
  };
}

export function publicRegistration(registration, payment = null, attendance = {}, adminNames = new Map()) {
  return {
    registrationId: registration.registrationId,
    fullName: registration.fullName,
    email: registration.email,
    phone: registration.phone,
    year: registration.year,
    department: registration.department || null,
    class: registration.class || null,
    ieeeMember: registration.ieeeMember === true,
    ieeeMembershipId: registration.ieeeMembershipId || null,
    workshopId: registration.workshopId,
    gender: registration.gender || null,
    foodPreference: registration.foodPreference || null,
    detailsCompletedAt: iso(registration.detailsCompletedAt),
    isHosteller: registration.isHosteller === true,
    hostel: registration.hostel || null,
    needsStay: registration.needsStay === true,
    stayType: registration.stayType || null,
    baseFee: registration.baseFee,
    stayFee: registration.stayFee,
    totalFee: registration.totalFee,
    paymentStatus: registration.paymentStatus,
    registrationStatus: registration.registrationStatus,
    razorpayOrderId: registration.razorpayOrderId || null,
    razorpayPaymentId: registration.razorpayPaymentId || null,
    paymentReconciliationRequired: registration.paymentReconciliationRequired === true
      || payment?.reconciliationRequired === true,
    seatReservationExpiresAt: iso(registration.seatReservationExpiresAt),
    capacityReleased: registration.capacityReleased === true,
    createdAt: iso(registration.createdAt),
    updatedAt: iso(registration.updatedAt),
    paymentCompletedAt: iso(registration.paymentCompletedAt),
    confirmedAt: iso(registration.confirmedAt),
    expiredAt: iso(registration.expiredAt),
    cancelledAt: iso(registration.cancelledAt),
    confirmationEmail: publicConfirmationEmail(registration.confirmationEmail),
    payment: publicPayment(payment),
    attendance: {
      event: publicCheckin(attendance.event, adminNames),
      workshop: publicCheckin(attendance.workshop, adminNames),
    },
  };
}

function latestPayments(payments) {
  const byRegistration = new Map();
  for (const payment of payments) {
    const key = payment.registrationId;
    if (!key) continue;
    const current = byRegistration.get(key);
    const currentTime = current?.updatedAt?.toMillis?.() || current?.createdAt?.toMillis?.() || 0;
    const nextTime = payment.updatedAt?.toMillis?.() || payment.createdAt?.toMillis?.() || 0;
    if (!current || nextTime >= currentTime) byRegistration.set(key, payment);
  }
  return byRegistration;
}

export function buildDashboard({ registrations, payments, capacity, workshops, checkins = [] }) {
  const registrationStatus = counters(REGISTRATION_STATES);
  const paymentStatus = counters(PAYMENT_STATES);
  const years = counters(YEAR_VALUES);
  const ieee = { member: 0, nonMember: 0 };
  const workshopRecords = Object.fromEntries(WORKSHOP_IDS.map((id) => [id, {
    totalRecords: 0, active: 0, confirmed: 0,
  }]));
  const accommodation = {
    activeHostellers: 0,
    activeNonHostellers: 0,
    activeStayRequests: 0,
    activeAcRequests: 0,
    activeNonAcRequests: 0,
    hostels: counters(HOSTELS),
  };

  for (const registration of registrations) {
    increment(registrationStatus, registration.registrationStatus);
    increment(paymentStatus, registration.paymentStatus);
    increment(years, registration.year);
    registration.ieeeMember === true ? ieee.member += 1 : ieee.nonMember += 1;
    const workshop = workshopRecords[registration.workshopId];
    if (workshop) {
      workshop.totalRecords += 1;
      if (['PAYMENT_PENDING', 'CONFIRMED'].includes(registration.registrationStatus)) workshop.active += 1;
      if (registration.registrationStatus === 'CONFIRMED') workshop.confirmed += 1;
    }

    if (!['PAYMENT_PENDING', 'CONFIRMED'].includes(registration.registrationStatus)) continue;
    if (registration.isHosteller) {
      accommodation.activeHostellers += 1;
      increment(accommodation.hostels, registration.hostel);
    } else {
      accommodation.activeNonHostellers += 1;
    }
    if (registration.needsStay) accommodation.activeStayRequests += 1;
    if (registration.stayType === 'AC') accommodation.activeAcRequests += 1;
    if (registration.stayType === 'NON_AC') accommodation.activeNonAcRequests += 1;
  }

  const paymentAttempts = { captured: 0, failed: 0 };
  for (const payment of payments) {
    if (payment.status === 'CAPTURED') paymentAttempts.captured += 1;
    if (payment.status === 'FAILED') paymentAttempts.failed += 1;
  }

  const paymentMap = latestPayments(payments);
  const reconciliationRequired = registrations.filter((registration) => (
    registration.paymentReconciliationRequired === true
      || paymentMap.get(registration.registrationId)?.reconciliationRequired === true
  )).length;

  return {
    registrations: {
      total: registrations.length,
      active: (registrationStatus.PAYMENT_PENDING || 0) + (registrationStatus.CONFIRMED || 0),
      status: registrationStatus,
    },
    payments: { status: paymentStatus, attempts: paymentAttempts, reconciliationRequired },
    years,
    ieee,
    accommodation,
    capacity: {
      event: { occupied: capacity?.eventOccupied ?? 0, capacity: capacity?.eventCapacity ?? 0 },
      firstYear: { occupied: capacity?.firstYearOccupied ?? 0, capacity: capacity?.firstYearCapacity ?? 0 },
    },
    workshops: WORKSHOP_IDS.map((id) => ({
      id,
      name: workshops[id]?.name || WORKSHOP_NAMES[id],
      occupied: workshops[id]?.occupied ?? 0,
      capacity: workshops[id]?.capacity ?? 0,
      active: workshops[id]?.active !== false,
      ...workshopRecords[id],
    })),
    attendance: {
      event: checkins.filter((item) => item.type === 'EVENT').length,
      workshop: checkins.filter((item) => item.type === 'WORKSHOP').length,
    },
  };
}

const CSV_VALUE = Object.freeze({
  fullName: (item) => item.fullName,
  email: (item) => item.email,
  phone: (item) => item.phone,
  year: (item) => item.year,
  department: (item) => item.department,
  class: (item) => item.class,
  ieeeMember: (item) => item.ieeeMember ? 'IEEE' : 'Non-IEEE',
  ieeeMembershipId: (item) => item.ieeeMembershipId,
  workshop: (item) => WORKSHOP_NAMES[item.workshopId] || item.workshopId,
  registrationId: (item) => item.registrationId,
  registrationStatus: (item) => item.registrationStatus,
  paymentStatus: (item) => item.paymentStatus,
  isHosteller: (item) => item.isHosteller ? 'Hosteller' : 'Non-hosteller',
  hostel: (item) => item.hostel,
  needsStay: (item) => item.needsStay ? 'Needs Stay' : 'No Stay',
  stayType: (item) => item.stayType,
  gender: (item) => item.gender,
  foodPreference: (item) => item.foodPreference,
  detailsCompleted: (item) => item.detailsCompletedAt ? 'Completed' : 'Not Completed',
  baseFee: (item) => item.baseFee,
  stayFee: (item) => item.stayFee,
  totalFee: (item) => item.totalFee,
  paymentReconciliationRequired: (item) => item.paymentReconciliationRequired ? 'Required' : 'Not Required',
  createdAt: (item) => item.createdAt,
  confirmedAt: (item) => item.confirmedAt,
  expiredAt: (item) => item.expiredAt,
  eventCheckedInAt: (item) => item.attendance?.event?.checkedInAt,
  workshopCheckedInAt: (item) => item.attendance?.workshop?.checkedInAt,
});

export function normalizeCsvColumns(value) {
  if (value === undefined) return [...DEFAULT_CSV_COLUMNS];
  if (typeof value !== 'string' || !value || value.length > 700) {
    throw new AppError('INVALID_CSV_COLUMNS', 'Choose at least one valid CSV field.', 400);
  }
  const keys = value.split(',');
  if (keys.length > CSV_FIELDS.length || new Set(keys).size !== keys.length
    || keys.some((key) => !Object.hasOwn(CSV_VALUE, key))) {
    throw new AppError('INVALID_CSV_COLUMNS', 'Choose only supported CSV fields.', 400);
  }
  return keys;
}

export function registrationsCsv(registrations, columns = DEFAULT_CSV_COLUMNS) {
  const selected = typeof columns === 'string' ? normalizeCsvColumns(columns) : columns;
  if (!Array.isArray(selected) || !selected.length || selected.some((key) => !Object.hasOwn(CSV_VALUE, key))) {
    throw new AppError('INVALID_CSV_COLUMNS', 'Choose at least one valid CSV field.', 400);
  }
  const labels = new Map(CSV_FIELDS.map(({ key, label }) => [key, label]));
  return createCsv(selected.map((key) => labels.get(key)),
    registrations.map((item) => selected.map((key) => CSV_VALUE[key](item) ?? '')));
}

export function buildTicketsReport(tickets, registrations) {
  const byDocument = new Map(registrations.map((registration) => [registration._docId, registration]));
  const confirmed = tickets.flatMap((ticket) => {
    const registration = byDocument.get(ticket.registrationDocId);
    if (!registration || ticket.active !== true
      || registration.registrationStatus !== 'CONFIRMED' || registration.paymentStatus !== 'PAID'
      || registration.ticketIssued !== true || registration.ticketId !== ticket.ticketId
      || registration.registrationId !== ticket.registrationId) return [];
    return [{ ticketId: ticket.ticketId, fullName: registration.fullName, year: registration.year }];
  });
  return { total: confirmed.length, tickets: confirmed };
}

export function createAdminReportingService({ db }) {
  async function readRegistrationsAndPayments() {
    const [registrationSnapshot, paymentSnapshot, checkinSnapshot, adminSnapshot] = await Promise.all([
      db.collection(COLLECTIONS.registrations).get(),
      db.collection(COLLECTIONS.payments).get(),
      db.collection(COLLECTIONS.checkins).get(),
      db.collection(COLLECTIONS.admins).get(),
    ]);
    const rawRegistrations = registrationSnapshot.docs.map((doc) => ({ ...doc.data(), _docId: doc.id }));
    const payments = paymentSnapshot.docs.map((doc) => doc.data());
    const checkins = checkinSnapshot.docs.map((doc) => doc.data());
    const adminNames = new Map(adminSnapshot.docs.map((doc) => [doc.id, doc.data().name]));
    const attendance = new Map();
    for (const checkin of checkins) {
      const current = attendance.get(checkin.registrationDocId) || {};
      if (checkin.type === 'EVENT') current.event = checkin;
      if (checkin.type === 'WORKSHOP') current.workshop = checkin;
      attendance.set(checkin.registrationDocId, current);
    }
    const paymentMap = latestPayments(payments);
    const registrations = rawRegistrations
      .map((registration) => publicRegistration(
        registration,
        paymentMap.get(registration.registrationId),
        attendance.get(registration._docId),
        adminNames,
      ))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { rawRegistrations, payments, checkins, registrations };
  }

  return {
    async tickets() {
      const [ticketSnapshot, registrationSnapshot] = await Promise.all([
        db.collection(COLLECTIONS.tickets).get(), db.collection(COLLECTIONS.registrations).get(),
      ]);
      return buildTicketsReport(
        ticketSnapshot.docs.map((doc) => ({ ...doc.data(), registrationDocId: doc.id })),
        registrationSnapshot.docs.map((doc) => ({ ...doc.data(), _docId: doc.id })),
      );
    },
    async dashboard() {
      const [{ rawRegistrations, payments, checkins }, capacitySnapshot, workshopSnapshots] = await Promise.all([
        readRegistrationsAndPayments(),
        db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.capacity).get(),
        Promise.all(WORKSHOP_IDS.map((id) => db.collection(COLLECTIONS.workshops).doc(id).get())),
      ]);
      const workshops = Object.fromEntries(workshopSnapshots.map((snapshot) => [snapshot.id, snapshot.data()]));
      return buildDashboard({
        registrations: rawRegistrations,
        payments,
        capacity: capacitySnapshot.data(),
        workshops,
        checkins,
      });
    },

    async registrations() {
      return (await readRegistrationsAndPayments()).registrations;
    },

    async registration(registrationId) {
      const { registrations } = await readRegistrationsAndPayments();
      const registration = registrations.find((item) => item.registrationId === registrationId);
      if (!registration) throw new AppError('REGISTRATION_NOT_FOUND', 'Registration not found.', 404);
      return registration;
    },

    async csv(input = {}) {
      const { columns, ...filters } = input;
      const selected = normalizeCsvColumns(columns);
      const normalized = normalizeExportFilters(filters);
      const registrations = (await readRegistrationsAndPayments()).registrations;
      return registrationsCsv(filterRegistrationsForExport(registrations, normalized), selected);
    },
  };
}
