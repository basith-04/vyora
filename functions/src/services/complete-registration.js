import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { AppError } from '../errors.js';
import { findRegistrationByPublicId } from './registration-access.js';
import { isPaidConfirmed } from './ticket.js';
import { completionErrors } from '../../shared/completion.js';

const FIELDS = ['gender', 'foodPreference', 'healthSafetyConcern', 'healthSafetyNote', 'detailsCompletedAt', 'termsAccepted', 'termsAcceptedAt'];
const INPUT_FIELDS = ['registrationId', 'gender', 'foodPreference', 'healthSafetyConcern', 'healthSafetyNote', 'termsAccepted'];
const NOT_FOUND = { success: false, code: 'REGISTRATION_NOT_FOUND' };
export function validateCompletion(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !INPUT_FIELDS.includes(key))) {
    throw new AppError('INVALID_COMPLETION', 'The form contains unsupported fields.', 400);
  }
  const fields = completionErrors(input);
  if (Object.keys(fields).length) throw new AppError('INVALID_COMPLETION', 'Please check the form.', 400, { fields });
  return { gender: input.gender, foodPreference: input.foodPreference,
    termsAccepted: true, healthSafetyConcern: input.healthSafetyConcern,
    healthSafetyNote: input.healthSafetyConcern ? input.healthSafetyNote.trim() : null };
}

export function createCompletionService({ db, clock = () => Date.now() }) {
  // Limit repeated attempts against a target, never students sharing a network.
  // Validation runs before limiter storage; raw IDs and health text are not stored.
  async function limit(input) {
    validateCompletion(input);
    const registrationId = input.registrationId.trim().toUpperCase();
    const key = createHash('sha256').update(`registration:${registrationId}`).digest('hex');
    const ref = db.collection('completionRateLimits').doc(`registration_${key}`);
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const now = clock();
      const current = snapshot.data();
      const active = current?.expiresAt?.toMillis() > now;
      if (active && current.count >= 10) throw new AppError('RATE_LIMITED', 'Please try again later.', 429);
      tx.set(ref, { count: active ? current.count + 1 : 1,
        expiresAt: active ? current.expiresAt : Timestamp.fromMillis(now + 15 * 60 * 1000) });
    });
  }
  async function submit(input) {
    const values = validateCompletion(input);
    let ref;
    try { ({ ref } = await findRegistrationByPublicId(db, input.registrationId.trim().toUpperCase())); }
    catch (error) { if (error.code === 'REGISTRATION_NOT_FOUND') return NOT_FOUND; throw error; }
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const current = snapshot.data();
      if (!isPaidConfirmed(current) || current.paymentReconciliationRequired === true || current.cancelledAt) return NOT_FOUND;
      // Preserve even partially populated information from any other flow.
      if (FIELDS.some((field) => Object.hasOwn(current, field))) return { success: false, code: 'ALREADY_COMPLETED' };
      const completedAt = Timestamp.fromMillis(clock());
      tx.update(ref, { ...values, detailsCompletedAt: completedAt, termsAcceptedAt: completedAt });
      return { success: true };
    });
  }
  return { submit, limit };
}
