import { registrationConfig, workshops, years } from './registrationConfig.js';

export const initialRegistration = {
  fullName: '', email: '', phone: '', year: '', ieeeMember: null,
  ieeeId: '', workshop: '', paymentProof: null,
};

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
  if (file.size > registrationConfig.maxPaymentProofBytes) return 'IMAGE MUST BE 5 MB OR SMALLER.';
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
  if (!workshops.some((workshop) => workshop.id === form.workshop)) errors.workshop = 'SELECT ONE AIDEX WORKSHOP.';
  const proofError = paymentProofError(form.paymentProof);
  if (proofError) errors.paymentProof = proofError;
  return errors;
}
