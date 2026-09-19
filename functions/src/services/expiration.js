import { Timestamp } from 'firebase-admin/firestore';
import { configurationError } from '../errors.js';
import {
  COLLECTIONS,
  REGISTRATION_STATUS,
  SYSTEM_DOCUMENTS,
} from '../config/constants.js';
import { duplicateLockIds } from './locks.js';

function asTimestamp(now) {
  if (now instanceof Timestamp) return now;
  const millis = typeof now === 'number' ? now : now.getTime();
  return Timestamp.fromMillis(millis);
}

function positiveCounter(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function createExpirationService({ db, clock = () => Date.now() }) {
  if (!db) throw new TypeError('A Firestore instance is required.');

  async function expireRegistration(registrationDocId, options = {}) {
    const registrationRef = db.collection(COLLECTIONS.registrations).doc(registrationDocId);
    const now = asTimestamp(options.now ?? clock());

    return db.runTransaction(async (transaction) => {
      const registrationSnapshot = await transaction.get(registrationRef);
      if (!registrationSnapshot.exists) return { outcome: 'NOT_FOUND' };

      const registration = registrationSnapshot.data();
      if (
        registration.registrationStatus !== REGISTRATION_STATUS.paymentPending
        || registration.capacityReleased === true
      ) {
        return { outcome: 'NO_OP', registrationStatus: registration.registrationStatus };
      }
      if (
        !(registration.seatReservationExpiresAt instanceof Timestamp)
        || registration.seatReservationExpiresAt.toMillis() > now.toMillis()
      ) {
        return { outcome: 'NOT_EXPIRED' };
      }

      const capacityRef = db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.capacity);
      const workshopRef = db.collection(COLLECTIONS.workshops).doc(registration.workshopId);
      const lockRefs = duplicateLockIds(registration).map((lockId) => (
        db.collection(COLLECTIONS.registrationLocks).doc(lockId)
      ));
      const [capacitySnapshot, workshopSnapshot, ...lockSnapshots] = await transaction.getAll(
        capacityRef,
        workshopRef,
        ...lockRefs,
      );
      if (!capacitySnapshot.exists || !workshopSnapshot.exists) {
        throw configurationError('Capacity storage is not initialized.');
      }

      const capacity = capacitySnapshot.data();
      const workshop = workshopSnapshot.data();
      if (!positiveCounter(capacity.eventOccupied) || !positiveCounter(workshop.occupied)) {
        throw configurationError('Capacity counters cannot be released safely.');
      }
      if (registration.year === 1 && !positiveCounter(capacity.firstYearOccupied)) {
        throw configurationError('First-year capacity cannot be released safely.');
      }

      transaction.update(registrationRef, {
        registrationStatus: REGISTRATION_STATUS.expired,
        capacityReleased: true,
        expiredAt: now,
        updatedAt: now,
      });
      transaction.update(capacityRef, {
        eventOccupied: capacity.eventOccupied - 1,
        firstYearOccupied: capacity.firstYearOccupied - (registration.year === 1 ? 1 : 0),
        updatedAt: now,
      });
      transaction.update(workshopRef, {
        occupied: workshop.occupied - 1,
        updatedAt: now,
      });
      lockSnapshots.forEach((lockSnapshot, index) => {
        if (
          lockSnapshot.exists
          && lockSnapshot.data()?.registrationDocId === registrationDocId
        ) {
          transaction.delete(lockRefs[index]);
        }
      });

      return { outcome: 'EXPIRED' };
    });
  }

  async function expirePendingReservations({ batchSize = 100, maxBatches = 10 } = {}) {
    let examined = 0;
    let expired = 0;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const now = asTimestamp(clock());
      const snapshot = await db.collection(COLLECTIONS.registrations)
        .where('registrationStatus', '==', REGISTRATION_STATUS.paymentPending)
        .where('capacityReleased', '==', false)
        .where('seatReservationExpiresAt', '<=', now)
        .orderBy('seatReservationExpiresAt', 'asc')
        .limit(batchSize)
        .get();

      if (snapshot.empty) break;
      examined += snapshot.size;
      // All releases update the shared capacity document. Process this small
      // event's candidates sequentially to avoid manufacturing contention.
      for (const document of snapshot.docs) {
        const result = await expireRegistration(document.id, { now });
        if (result.outcome === 'EXPIRED') expired += 1;
      }
      if (snapshot.size < batchSize) break;
    }

    return { examined, expired };
  }

  return { expireRegistration, expirePendingReservations };
}
