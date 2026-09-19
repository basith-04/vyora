import { AppError } from '../errors.js';
import { HOSTELS, STAY_TYPES, WORKSHOP_IDS, YEARS } from '../config/constants.js';

const PARTICIPANT_FIELDS = new Set([
  'fullName',
  'email',
  'phone',
  'year',
  'ieeeMember',
  'ieeeMembershipId',
  'isHosteller',
  'hostel',
  'needsStay',
  'stayType',
  'workshopId',
]);

const AUTHORITATIVE_FIELDS = new Set([
  'registrationId',
  'baseFee',
  'stayFee',
  'totalFee',
  'paymentStatus',
  'registrationStatus',
  'capacity',
  'capacityReleased',
  'seatReservationExpiresAt',
  'createdAt',
  'updatedAt',
  'expiredAt',
  'confirmedAt',
  'paymentCompletedAt',
  'cancelledAt',
  'ticketIssued',
  'ticketId',
]);

export function normalizeFullName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizePhone(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const input = String(value).trim();
  if (!/^[+\d\s().-]+$/.test(input)) return '';
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

export function normalizeIeeeMembershipId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateAndNormalizeRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('INVALID_PARTICIPANT_DATA', 'Registration data must be an object.', 400);
  }

  const unknownFields = Object.keys(input).filter((field) => !PARTICIPANT_FIELDS.has(field));
  const attemptedAuthoritativeFields = unknownFields.filter((field) => AUTHORITATIVE_FIELDS.has(field));
  if (unknownFields.length > 0) {
    throw new AppError(
      'INVALID_PARTICIPANT_DATA',
      attemptedAuthoritativeFields.length > 0
        ? 'Authoritative registration fields cannot be supplied by the client.'
        : 'Registration data contains unsupported fields.',
      400,
      { fields: unknownFields },
    );
  }

  const errors = {};
  const fullName = normalizeFullName(input.fullName);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const ieeeMembershipId = normalizeIeeeMembershipId(input.ieeeMembershipId);

  if (!fullName || fullName.length > 120) errors.fullName = 'A valid full name is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    errors.email = 'A valid email address is required.';
  }
  if (!/^\d{10}$/.test(phone)) errors.phone = 'A valid 10-digit phone number is required.';
  if (!YEARS.includes(input.year)) errors.year = 'Year must be one of 1, 2, 3, or 4.';
  if (typeof input.ieeeMember !== 'boolean') errors.ieeeMember = 'IEEE membership status is required.';
  if (typeof input.isHosteller !== 'boolean') errors.isHosteller = 'Hosteller status is required.';
  if (typeof input.needsStay !== 'boolean') errors.needsStay = 'Stay requirement is required.';
  if (!WORKSHOP_IDS.includes(input.workshopId)) errors.workshopId = 'A valid workshop is required.';

  if (input.ieeeMember === true && !ieeeMembershipId) {
    errors.ieeeMembershipId = 'IEEE membership ID is required for IEEE members.';
  }
  if (input.ieeeMember === false && input.ieeeMembershipId !== null) {
    errors.ieeeMembershipId = 'IEEE membership ID must be null for non-IEEE participants.';
  }

  const accommodationErrors = {};
  if (input.isHosteller === true) {
    if (!HOSTELS.includes(input.hostel)) accommodationErrors.hostel = 'A valid hostel is required.';
    if (input.needsStay !== false) accommodationErrors.needsStay = 'Hostellers cannot request event stay.';
    if (input.stayType !== null) accommodationErrors.stayType = 'Hostellers cannot select a stay type.';
  } else if (input.isHosteller === false) {
    if (input.hostel !== null) accommodationErrors.hostel = 'Non-hostellers cannot select an existing hostel.';
    if (input.needsStay === true && !STAY_TYPES.includes(input.stayType)) {
      accommodationErrors.stayType = 'Stay type must be AC or NON_AC when stay is required.';
    }
    if (input.needsStay === false && input.stayType !== null) {
      accommodationErrors.stayType = 'Stay type must be null when stay is not required.';
    }
  }

  if (Object.keys(accommodationErrors).length > 0) {
    throw new AppError(
      'INVALID_ACCOMMODATION_SELECTION',
      'The accommodation selection is not valid.',
      400,
      { fields: accommodationErrors },
    );
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError(
      'INVALID_PARTICIPANT_DATA',
      'The participant data is not valid.',
      400,
      { fields: errors },
    );
  }

  return {
    fullName,
    email,
    phone,
    year: input.year,
    ieeeMember: input.ieeeMember,
    ieeeMembershipId: input.ieeeMember ? ieeeMembershipId : null,
    isHosteller: input.isHosteller,
    hostel: input.isHosteller ? input.hostel : null,
    needsStay: input.isHosteller ? false : input.needsStay,
    stayType: !input.isHosteller && input.needsStay ? input.stayType : null,
    workshopId: input.workshopId,
  };
}
