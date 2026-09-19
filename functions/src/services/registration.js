import { Timestamp } from 'firebase-admin/firestore';
import { AppError, configurationError } from '../errors.js';
import {
  COLLECTIONS,
  PAYMENT_STATUS,
  REGISTRATION_STATUS,
  SYSTEM_DOCUMENTS,
} from '../config/constants.js';
import { validateAndNormalizeRegistration } from '../validation/registration.js';
import { calculatePricing } from './pricing.js';
import { duplicateLockIds } from './locks.js';

function assertCapacityDocument(capacity) {
  const fields = ['eventCapacity', 'eventOccupied', 'firstYearCapacity', 'firstYearOccupied'];
  if (!capacity || fields.some((field) => !Number.isSafeInteger(capacity[field]) || capacity[field] < 0)) {
    throw configurationError('Capacity is not configured correctly.');
  }
  if (
    capacity.eventOccupied > capacity.eventCapacity
    || capacity.firstYearOccupied > capacity.firstYearCapacity
  ) {
    throw configurationError('Capacity counters violate their configured limits.');
  }
}

function assertWorkshopDocument(workshop, expectedId) {
  if (
    !workshop
    || workshop.id !== expectedId
    || !Number.isSafeInteger(workshop.capacity)
    || workshop.capacity < 0
    || !Number.isSafeInteger(workshop.occupied)
    || workshop.occupied < 0
    || workshop.occupied > workshop.capacity
    || typeof workshop.active !== 'boolean'
  ) {
    throw configurationError('Workshop capacity is not configured correctly.');
  }
}

function reservationDurationSeconds(config) {
  if (!Number.isSafeInteger(config?.reservationDurationSeconds) || config.reservationDurationSeconds <= 0) {
    throw configurationError('Reservation duration is not configured correctly.');
  }
  return config.reservationDurationSeconds;
}

function publicRegistrationId(documentId) {
  return `VYR26-${documentId.toUpperCase()}`;
}

function toTimestamp(now) {
  const millis = typeof now === 'number' ? now : now.getTime();
  return Timestamp.fromMillis(millis);
}

export function createRegistrationService({ db, clock = () => Date.now() }) {
  if (!db) throw new TypeError('A Firestore instance is required.');

  return async function createRegistration(input, { recoveryTokenHash } = {}) {
    if (!/^[a-f0-9]{64}$/.test(recoveryTokenHash ?? '')) {
      throw new AppError('INVALID_RECOVERY_TOKEN', 'A valid registration recovery token is required.', 400);
    }
    const participant = validateAndNormalizeRegistration(input);
    const registrationRef = db.collection(COLLECTIONS.registrations).doc();
    const registrationId = publicRegistrationId(registrationRef.id);
    const capacityRef = db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.capacity);
    const configRef = db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.registrationConfig);
    const workshopRef = db.collection(COLLECTIONS.workshops).doc(participant.workshopId);
    const lockRefs = duplicateLockIds(participant).map((lockId) => (
      db.collection(COLLECTIONS.registrationLocks).doc(lockId)
    ));

    return db.runTransaction(async (transaction) => {
      const [configSnapshot, capacitySnapshot, workshopSnapshot, ...lockSnapshots] = await transaction.getAll(
        configRef,
        capacityRef,
        workshopRef,
        ...lockRefs,
      );

      if (!configSnapshot.exists || !capacitySnapshot.exists || !workshopSnapshot.exists) {
        throw configurationError('Registration storage has not been initialized.');
      }

      const config = configSnapshot.data();
      const capacity = capacitySnapshot.data();
      const workshop = workshopSnapshot.data();
      assertCapacityDocument(capacity);
      assertWorkshopDocument(workshop, participant.workshopId);

      if (config.registrationOpen !== true) {
        throw new AppError('REGISTRATION_CLOSED', 'Registration is currently closed.', 409);
      }
      const activeLocks = lockSnapshots.filter(
        (snapshot) => snapshot.exists && snapshot.data()?.status === 'ACTIVE',
      );
      if (activeLocks.length > 0) {
        const lockedDocumentIds = new Set(
          activeLocks.map((snapshot) => snapshot.data().registrationDocId),
        );
        if (lockedDocumentIds.size === 1) {
          const [lockedDocumentId] = lockedDocumentIds;
          const lockedSnapshot = await transaction.get(
            db.collection(COLLECTIONS.registrations).doc(lockedDocumentId),
          );
          const locked = lockedSnapshot.data();
          if (
            lockedSnapshot.exists
            && locked.recoveryTokenHash === recoveryTokenHash
            && locked.registrationStatus === REGISTRATION_STATUS.paymentPending
            && locked.capacityReleased === false
            && locked.email === participant.email
            && locked.phone === participant.phone
          ) {
            return {
              registrationDocId: lockedSnapshot.id,
              registrationId: locked.registrationId,
              registrationStatus: locked.registrationStatus,
              paymentStatus: locked.paymentStatus,
              workshopId: locked.workshopId,
              pricing: {
                baseFee: locked.baseFee,
                stayFee: locked.stayFee,
                totalFee: locked.totalFee,
              },
              seatReservationExpiresAt: locked.seatReservationExpiresAt,
              reused: true,
            };
          }
        }
        throw new AppError('DUPLICATE_REGISTRATION', 'An active registration already exists.', 409);
      }
      if (capacity.eventOccupied >= capacity.eventCapacity) {
        throw new AppError('EVENT_FULL', 'Registration capacity is full.', 409);
      }
      if (!workshop.active) {
        throw new AppError('WORKSHOP_UNAVAILABLE', 'The selected workshop is unavailable.', 409);
      }
      if (workshop.occupied >= workshop.capacity) {
        throw new AppError('WORKSHOP_FULL', 'The selected workshop is full.', 409);
      }
      if (participant.year === 1 && capacity.firstYearOccupied >= capacity.firstYearCapacity) {
        throw new AppError('FIRST_YEAR_FULL', 'First-year registration capacity is full.', 409);
      }

      const now = toTimestamp(clock());
      const expiresAt = Timestamp.fromMillis(
        now.toMillis() + reservationDurationSeconds(config) * 1000,
      );
      const pricing = calculatePricing(participant, config.pricing);

      const registration = {
        registrationId,
        ...participant,
        ...pricing,
        paymentStatus: PAYMENT_STATUS.pending,
        registrationStatus: REGISTRATION_STATUS.paymentPending,
        seatReservationExpiresAt: expiresAt,
        capacityReleased: false,
        recoveryTokenHash,
        orderCreationStatus: null,
        orderCreationAttemptId: null,
        orderCreationUpdatedAt: null,
        razorpayReceipt: null,
        razorpayOrderId: null,
        razorpayOrderAmount: null,
        razorpayOrderCurrency: null,
        razorpayPaymentId: null,
        paymentReconciliationRequired: false,
        ticketIssued: false,
        ticketId: null,
        createdAt: now,
        updatedAt: now,
        paymentCompletedAt: null,
        confirmedAt: null,
        expiredAt: null,
        cancelledAt: null,
      };

      transaction.create(registrationRef, registration);
      transaction.update(capacityRef, {
        eventOccupied: capacity.eventOccupied + 1,
        firstYearOccupied: capacity.firstYearOccupied + (participant.year === 1 ? 1 : 0),
        updatedAt: now,
      });
      transaction.update(workshopRef, {
        occupied: workshop.occupied + 1,
        updatedAt: now,
      });
      for (const lockRef of lockRefs) {
        transaction.set(lockRef, {
          registrationDocId: registrationRef.id,
          registrationId,
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        });
      }

      return {
        registrationDocId: registrationRef.id,
        registrationId,
        registrationStatus: registration.registrationStatus,
        paymentStatus: registration.paymentStatus,
        workshopId: participant.workshopId,
        pricing,
        seatReservationExpiresAt: expiresAt,
      };
    });
  };
}
