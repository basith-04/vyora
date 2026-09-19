import { hostels, registrationOptions, workshops, years } from './registrationOptions.js';

export const initialRegistration = {
  fullName: '', email: '', phone: '', year: '', ieeeMember: null,
  ieeeMembershipId: '', isHosteller: null, hostel: null, needsStay: null,
  stayType: null, workshopId: '',
};

export function updateRegistrationField(form, field, value) {
  return {
    ...form,
    [field]: value,
    ...(field === 'ieeeMember' && value === false ? { ieeeMembershipId: null } : {}),
    ...(field === 'ieeeMember' && value === true ? { ieeeMembershipId: '' } : {}),
    ...(field === 'isHosteller' && value === true ? { hostel: null, needsStay: false, stayType: null } : {}),
    ...(field === 'isHosteller' && value === false ? { hostel: null, needsStay: null, stayType: null } : {}),
    ...(field === 'needsStay' && value === false ? { stayType: null } : {}),
  };
}

export function calculateFees(form) {
  const baseFee = form.ieeeMember === null ? null : form.ieeeMember ? registrationOptions.prices.ieee : registrationOptions.prices.nonIeee;
  const stayFee = form.isHosteller === false && form.needsStay === true
    ? form.stayType === 'AC'
      ? registrationOptions.accommodation.ac
      : form.stayType === 'NON_AC'
        ? registrationOptions.accommodation.nonAc
        : null
    : 0;
  const accommodationChosen = form.isHosteller === true
    || (form.isHosteller === false && form.needsStay === false)
    || (form.isHosteller === false && form.needsStay === true && stayFee !== null);
  return { baseFee, stayFee: stayFee ?? 0, totalFee: baseFee !== null && accommodationChosen ? baseFee + (stayFee ?? 0) : null };
}

export function buildRegistrationSubmission(form) {
  return {
    ...form,
    fullName: form.fullName.trim(),
    phone: normalizePhone(form.phone),
    email: form.email.trim().toLowerCase(),
    ieeeMembershipId: form.ieeeMember ? form.ieeeMembershipId.trim() : null,
    hostel: form.isHosteller ? form.hostel : null,
    needsStay: form.isHosteller ? false : form.needsStay,
    stayType: !form.isHosteller && form.needsStay ? form.stayType : null,
    ...calculateFees(form),
  };
}

export function normalizePhone(value) {
  let digits = value.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

export function validateRegistration(form) {
  const errors = {};
  if (!form.fullName.trim()) errors.fullName = 'ENTER YOUR FULL NAME.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'ENTER A VALID EMAIL ADDRESS.';
  if (!/^\d{10}$/.test(normalizePhone(form.phone))) errors.phone = 'ENTER A 10-DIGIT MOBILE NUMBER.';
  if (!years.some((year) => year.id === form.year)) errors.year = 'SELECT YOUR YEAR OF STUDY.';
  if (form.isHosteller === null) errors.isHosteller = 'SELECT YOUR HOSTELLER STATUS.';
  if (form.isHosteller === true && !hostels.some((hostel) => hostel.id === form.hostel)) errors.hostel = 'SELECT YOUR HOSTEL.';
  if (form.isHosteller === false && form.needsStay === null) errors.needsStay = 'SELECT IF YOU NEED STAY.';
  if (form.isHosteller === false && form.needsStay === true && !['AC', 'NON_AC'].includes(form.stayType)) errors.stayType = 'SELECT AC OR NON-AC STAY.';
  if (form.ieeeMember === null) errors.ieeeMember = 'SELECT YOUR IEEE STATUS.';
  if (form.ieeeMember === true && !form.ieeeMembershipId.trim()) errors.ieeeMembershipId = 'IEEE MEMBERSHIP ID IS REQUIRED.';
  if (!workshops.some((workshop) => workshop.id === form.workshopId)) errors.workshopId = 'SELECT ONE AIDEX WORKSHOP.';
  return errors;
}
