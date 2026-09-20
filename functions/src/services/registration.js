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

export function assertCapacityDocument(capacity) {
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

export function assertWorkshopDocument(workshop, expectedId) {
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

const RESUMABLE_STATUSES = new Set([
  REGISTRATION_STATUS.paymentPending,
  REGISTRATION_STATUS.expired,
]);

const PARTICIPANT_MATCH_FIELDS = [
  'fullName', 'email', 'phone', 'year', 'department', 'class', 'ieeeMember',
  'ieeeMembershipId', 'isHosteller', 'hostel', 'needsStay', 'stayType', 'workshopId',
];

function sameParticipant(registration, participant) {
  return PARTICIPANT_MATCH_FIELDS.every((field) => registration?.[field] === participant[field]);
}

function recoveryTokenHashes(registration, recoveryTokenHash) {
  const hashes = Array.isArray(registration.recoveryTokenHashes)
    ? registration.recoveryTokenHashes.filter((value) => /^[a-f0-9]{64}$/.test(value))
    : [];
  if (registration.recoveryTokenHash === recoveryTokenHash || hashes.includes(recoveryTokenHash)) {
    return hashes;
  }
  return [...hashes, recoveryTokenHash].slice(-5);
}

function registrationResult(snapshot, registration, extra = {}) {
  return {
    registrationDocId: snapshot.id,
    registrationId: registration.registrationId,
    registrationStatus: registration.registrationStatus,
    paymentStatus: registration.paymentStatus,
    workshopId: registration.workshopId,
    pricing: {
      baseFee: registration.baseFee,
      stayFee: registration.stayFee,
      totalFee: registration.totalFee,
    },
    seatReservationExpiresAt: registration.seatReservationExpiresAt,
    reused: true,
    ...extra,
  };
}

function assertAvailableCapacity(capacity, workshop, participant) {
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
}

export function createRegistrationService({ db, clock = () => Date.now() }) {
  if (!db) throw new TypeError('A Firestore instance is required.');

  async function findResumable(input) {
    const participant = validateAndNormalizeRegistration(input);
    const snapshot = await db.collection(COLLECTIONS.registrations)
      .where('email', '==', participant.email)
      .get();
    const matches = snapshot.docs
      .filter((document) => {
        const registration = document.data();
        return RESUMABLE_STATUSES.has(registration.registrationStatus)
          && sameParticipant(registration, participant);
      })
      .sort((left, right) => (
        (right.data().createdAt?.toMillis?.() || 0) - (left.data().createdAt?.toMillis?.() || 0)
      ));
    if (!matches.length) return null;
    return { ref: matches[0].ref, data: matches[0].data(), participant };
  }

  async function createRegistration(input, { recoveryTokenHash } = {}) {
    if (!/^[a-f0-9]{64}$/.test(recoveryTokenHash ?? '')) {
      throw new AppError('INVALID_RECOVERY_TOKEN', 'A valid registration recovery token is required.', 400);
    }
    const participant = validateAndNormalizeRegistration(input);
    const resumable = await findResumable(input);
    const registrationRef = db.collection(COLLECTIONS.registrations).doc();
    const registrationId = publicRegistrationId(registrationRef.id);
    const capacityRef = db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.capacity);
    const configRef = db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.registrationConfig);
    const workshopRef = db.collection(COLLECTIONS.workshops).doc(participant.workshopId);
    const lockRefs = duplicateLockIds(participant).map((lockId) => (
      db.collection(COLLECTIONS.registrationLocks).doc(lockId)
    ));

    return db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(
        configRef,
        capacityRef,
        workshopRef,
        ...lockRefs,
        ...(resumable ? [resumable.ref] : []),
      );
      const [configSnapshot, capacitySnapshot, workshopSnapshot] = snapshots;
      const lockSnapshots = snapshots.slice(3, 3 + lockRefs.length);
      const resumableSnapshot = resumable ? snapshots.at(-1) : null;

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
          const lockedSnapshot = resumableSnapshot?.id === lockedDocumentId
            ? resumableSnapshot
            : await transaction.get(db.collection(COLLECTIONS.registrations).doc(lockedDocumentId));
          const locked = lockedSnapshot.data();
          if (
            lockedSnapshot.exists
            && locked.registrationStatus === REGISTRATION_STATUS.paymentPending
            && locked.capacityReleased === false
            && sameParticipant(locked, participant)
          ) {
            const now = toTimestamp(clock());
            const due = locked.seatReservationExpiresAt?.toMillis?.() <= now.toMillis();
            const expiresAt = due
              ? Timestamp.fromMillis(now.toMillis() + reservationDurationSeconds(config) * 1000)
              : locked.seatReservationExpiresAt;
            transaction.update(lockedSnapshot.ref, {
              recoveryTokenHashes: recoveryTokenHashes(locked, recoveryTokenHash),
              seatReservationExpiresAt: expiresAt,
              updatedAt: now,
            });
            return registrationResult(lockedSnapshot, {
              ...locked,
              seatReservationExpiresAt: expiresAt,
            }, { reservationRenewed: due });
          }
        }
        throw new AppError('DUPLICATE_REGISTRATION', 'An active registration already exists.', 409);
      }

      if (resumableSnapshot?.exists) {
        const existing = resumableSnapshot.data();
        if (!sameParticipant(existing, participant) || !RESUMABLE_STATUSES.has(existing.registrationStatus)) {
          throw new AppError('DUPLICATE_REGISTRATION', 'An active registration already exists.', 409);
        }
        if (existing.capacityReleased !== true) {
          const now = toTimestamp(clock());
          const expiresAt = existing.seatReservationExpiresAt?.toMillis?.() <= now.toMillis()
            ? Timestamp.fromMillis(now.toMillis() + reservationDurationSeconds(config) * 1000)
            : existing.seatReservationExpiresAt;
          transaction.update(resumableSnapshot.ref, {
            registrationStatus: REGISTRATION_STATUS.paymentPending,
            recoveryTokenHashes: recoveryTokenHashes(existing, recoveryTokenHash),
            seatReservationExpiresAt: expiresAt,
            updatedAt: now,
          });
          for (const lockRef of lockRefs) {
            transaction.set(lockRef, {
              registrationDocId: resumableSnapshot.id,
              registrationId: existing.registrationId,
              status: 'ACTIVE',
              createdAt: now,
              updatedAt: now,
            });
          }
          return registrationResult(resumableSnapshot, {
            ...existing,
            registrationStatus: REGISTRATION_STATUS.paymentPending,
            seatReservationExpiresAt: expiresAt,
          }, { reservationRenewed: true });
        }

        assertAvailableCapacity(capacity, workshop, participant);
        const now = toTimestamp(clock());
        const expiresAt = Timestamp.fromMillis(
          now.toMillis() + reservationDurationSeconds(config) * 1000,
        );
        transaction.update(resumableSnapshot.ref, {
          registrationStatus: REGISTRATION_STATUS.paymentPending,
          capacityReleased: false,
          recoveryTokenHashes: recoveryTokenHashes(existing, recoveryTokenHash),
          seatReservationExpiresAt: expiresAt,
          updatedAt: now,
        });
        transaction.update(capacityRef, {
          eventOccupied: capacity.eventOccupied + 1,
          firstYearOccupied: capacity.firstYearOccupied + (participant.year === 1 ? 1 : 0),
          updatedAt: now,
        });
        transaction.update(workshopRef, { occupied: workshop.occupied + 1, updatedAt: now });
        for (const lockRef of lockRefs) {
          transaction.set(lockRef, {
            registrationDocId: resumableSnapshot.id,
            registrationId: existing.registrationId,
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          });
        }
        return registrationResult(resumableSnapshot, {
          ...existing,
          registrationStatus: REGISTRATION_STATUS.paymentPending,
          capacityReleased: false,
          seatReservationExpiresAt: expiresAt,
        }, { reservationRenewed: true });
      }

      assertAvailableCapacity(capacity, workshop, participant);

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
        recoveryTokenHashes: [recoveryTokenHash],
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
        confirmationEmail: {
          status: 'PENDING',
          attempts: 0,
          sentAt: null,
          lastAttemptAt: null,
          lastErrorCode: null,
          providerMessageId: null,
          leaseExpiresAt: null,
        },
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
  }

  createRegistration.findResumable = findResumable;
  return createRegistration;
}
