import { normalizePhone } from './registrationValidation.js';

export function participantContact(phone) {
  if (typeof phone !== 'string' || !/^\+?[\d\s().-]+$/.test(phone.trim())) return null;
  const number = phone.trim();
  const dialNumber = number.replace(/[\s().-]/g, '');
  // Preserve international prefixes; reuse registration normalization for local numbers.
  const valid = dialNumber.startsWith('+') ? /^\+[1-9]\d{6,14}$/.test(dialNumber)
    : /^\d{10}$/.test(dialNumber) && normalizePhone(number) === dialNumber;
  return valid ? { number, href: `tel:${dialNumber}` } : null;
}

export async function copyParticipantPhone(phone, clipboard = globalThis.navigator?.clipboard) {
  const contact = participantContact(phone);
  if (!contact || !clipboard?.writeText) return false;
  try { await clipboard.writeText(contact.number); return true; }
  catch { return false; }
}
