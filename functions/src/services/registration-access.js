import { AppError } from '../errors.js';
import { COLLECTIONS } from '../config/constants.js';

export async function findRegistrationByPublicId(db, registrationId) {
  if (typeof registrationId !== 'string' || !/^VYR26-[A-Z0-9]{20}$/.test(registrationId)) {
    throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
  }
  const snapshot = await db.collection(COLLECTIONS.registrations)
    .where('registrationId', '==', registrationId)
    .limit(1)
    .get();
  if (snapshot.empty) {
    throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
  }
  return { ref: snapshot.docs[0].ref, data: snapshot.docs[0].data() };
}

export async function getAuthorizedRegistration(db, registrationId, recoveryTokenHash) {
  const result = await findRegistrationByPublicId(db, registrationId);
  if (result.data.recoveryTokenHash !== recoveryTokenHash) {
    // Deliberately indistinguishable from a missing registration.
    throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
  }
  return result;
}

export async function findRegistrationByRecoveryToken(db, recoveryTokenHash) {
  const snapshot = await db.collection(COLLECTIONS.registrations)
    .where('recoveryTokenHash', '==', recoveryTokenHash)
    .limit(2)
    .get();
  if (snapshot.size !== 1) {
    throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
  }
  return { ref: snapshot.docs[0].ref, data: snapshot.docs[0].data() };
}
