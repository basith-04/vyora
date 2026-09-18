import { hostels, registrationOptions, workshops, years } from './registrationOptions.js';

export const initialRegistration = {
  fullName: '', email: '', phone: '', year: '', ieeeMember: null,
  ieeeId: '', isHosteller: null, hostel: '', needsStay: null,
  workshop: '', paymentProof: null,
};

export function updateRegistrationField(form, field, value) {
  return {
    ...form,
    [field]: value,
    ...(field === 'ieeeMember' && value === false ? { ieeeId: '' } : {}),
    ...(field === 'isHosteller' ? { hostel: '', needsStay: null } : {}),
  };
}

export function calculateFees(form) {
  const baseFee = form.ieeeMember === null ? null : form.ieeeMember ? registrationOptions.prices.ieee : registrationOptions.prices.nonIeee;
  const stayFee = form.isHosteller === false && form.needsStay === true ? registrationOptions.stayFee : 0;
  const accommodationChosen = form.isHosteller === true || (form.isHosteller === false && form.needsStay !== null);
  return { baseFee, stayFee, totalFee: baseFee !== null && accommodationChosen ? baseFee + stayFee : null };
}

export function buildRegistrationSubmission(form) {
  return {
    ...form,
    fullName: form.fullName.trim(),
    email: form.email.trim(),
    phone: normalizePhone(form.phone),
    ieeeId: form.ieeeMember ? form.ieeeId.trim() : '',
    hostel: form.isHosteller ? form.hostel : null,
    needsStay: form.isHosteller ? null : form.needsStay,
    ...calculateFees(form),
  };
}

export function normalizePhone(value) {
  let digits = value.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

export function paymentProofError(file) {
  if (!file) return 'UPLOAD YOUR PAYMENT SCREENSHOT.';
  const accepted = ['image/jpeg', 'image/png', 'image/webp'];
  const validExtension = /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!accepted.includes(file.type) && !(file.type === '' && validExtension)) return 'USE A JPG, PNG, OR WEBP IMAGE.';
  if (file.size > registrationOptions.maxPaymentProofBytes) return 'IMAGE MUST BE 5 MB OR SMALLER.';
  return '';
}

export function validateRegistration(form) {
  const errors = {};
  if (!form.fullName.trim()) errors.fullName = 'ENTER YOUR FULL NAME.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'ENTER A VALID EMAIL ADDRESS.';
  if (!/^\d{10}$/.test(normalizePhone(form.phone))) errors.phone = 'ENTER A 10-DIGIT MOBILE NUMBER.';
  if (!years.some((year) => year.id === form.year)) errors.year = 'SELECT YOUR YEAR OF STUDY.';
  if (form.ieeeMember === null) errors.ieeeMember = 'SELECT YOUR IEEE STATUS.';
  if (form.ieeeMember === true && !form.ieeeId.trim()) errors.ieeeId = 'IEEE MEMBERSHIP ID IS REQUIRED.';
  if (form.isHosteller === null) errors.isHosteller = 'SELECT YOUR HOSTELLER STATUS.';
  if (form.isHosteller === true && !hostels.includes(form.hostel)) errors.hostel = 'SELECT YOUR HOSTEL.';
  if (form.isHosteller === false && form.needsStay === null) errors.needsStay = 'SELECT IF YOU NEED STAY.';
  if (!workshops.some((workshop) => workshop.id === form.workshop)) errors.workshop = 'SELECT ONE AIDEX WORKSHOP.';
  const proofError = paymentProofError(form.paymentProof);
  if (proofError) errors.paymentProof = proofError;
  return errors;
}
