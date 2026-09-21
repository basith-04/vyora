import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';
import {
  COLLECTIONS,
  ORDER_CREATION_STATUS,
  REGISTRATION_STATUS,
  SYSTEM_DOCUMENTS,
} from '../config/constants.js';
import {
  findRegistrationByRecoveryToken,
  getAuthorizedRegistration,
  registrationHasRecoveryToken,
} from './registration-access.js';

const CURRENCY = 'INR';
const CAPACITY_ERRORS = new Set(['EVENT_FULL', 'FIRST_YEAR_FULL', 'WORKSHOP_FULL', 'WORKSHOP_UNAVAILABLE']);

function asTimestamp(now) {
  return Timestamp.fromMillis(typeof now === 'number' ? now : now.getTime());
}

export function rupeesToPaise(rupees) {
  if (!Number.isSafeInteger(rupees) || rupees < 0) {
    throw new AppError('INTERNAL_ERROR', 'Stored pricing is invalid.', 500);
  }
  const paise = rupees * 100;
  if (!Number.isSafeInteger(paise)) {
    throw new AppError('INTERNAL_ERROR', 'Stored pricing is invalid.', 500);
  }
  return paise;
}

function iso(timestamp) {
  return timestamp?.toDate().toISOString();
}

function participantResponse(registration, publicKeyId) {
  const response = {
    registrationId: registration.registrationId,
    registrationStatus: registration.registrationStatus,
    paymentStatus: registration.paymentStatus,
    workshopId: registration.workshopId,
    pricing: {
      baseFee: registration.baseFee,
      stayFee: registration.stayFee,
      totalFee: registration.totalFee,
    },
    seatReservationExpiresAt: iso(registration.seatReservationExpiresAt),
    paymentReconciliationRequired: registration.paymentReconciliationRequired === true,
  };
  if (
    registration.registrationStatus === REGISTRATION_STATUS.paymentPending
    && registration.capacityReleased === false
    && registration.orderCreationStatus === ORDER_CREATION_STATUS.ready
  ) {
    response.checkout = {
      keyId: publicKeyId,
      orderId: registration.razorpayOrderId,
      amount: registration.razorpayOrderAmount,
      currency: registration.razorpayOrderCurrency,
      name: "VYORA '26",
      description: 'VYORA 2026 registration',
      prefill: {
        name: registration.fullName,
        email: registration.email,
        contact: registration.phone,
      },
    };
  }
  return response;
}

function assertOrder(order, expected) {
  if (
    !order
    || typeof order.id !== 'string'
    || order.amount !== expected.amount
    || order.currency !== CURRENCY
    || order.receipt !== expected.receipt
  ) {
    throw new AppError('PAYMENT_ORDER_FAILED', 'The payment order could not be prepared.', 502);
  }
}

export function createCheckoutService({
  db,
  createRegistration,
  expirationService,
  razorpay,
  paymentService = null,
  clock = () => Date.now(),
  logger = console,
}) {
  const registrationConfigRef = db.collection(COLLECTIONS.system)
    .doc(SYSTEM_DOCUMENTS.registrationConfig);

  function requireRegistrationOpen(snapshot) {
    if (!snapshot.exists || snapshot.data()?.registrationOpen !== true) {
      throw new AppError('REGISTRATION_CLOSED', 'Registration is currently closed.', 409);
    }
  }

  async function assertRegistrationOpen() {
    const snapshot = await registrationConfigRef.get();
    requireRegistrationOpen(snapshot);
  }

  async function expireIfDue(ref, registration) {
    if (
      registration.registrationStatus === REGISTRATION_STATUS.paymentPending
      && registration.capacityReleased === false
      && registration.seatReservationExpiresAt?.toMillis() <= asTimestamp(clock()).toMillis()
    ) {
      await expirationService.expireRegistration(ref.id);
      return true;
    }
    return false;
  }

  async function loadAuthorized(registrationId, recoveryTokenHash) {
    const result = await getAuthorizedRegistration(db, registrationId, recoveryTokenHash);
    if (await expireIfDue(result.ref, result.data)) {
      const refreshed = await result.ref.get();
      return { ref: result.ref, data: refreshed.data() };
    }
    return result;
  }

  async function associateOrder(ref, expected, order) {
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
      const registration = snapshot.data();
      if (!registrationHasRecoveryToken(registration, expected.recoveryTokenHash)) {
        throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
      }
      if (
        registration.orderCreationStatus === ORDER_CREATION_STATUS.ready
        && registration.razorpayOrderId !== order.id
      ) {
        throw new AppError('PAYMENT_ORDER_FAILED', 'A different payment order is already active.', 409);
      }
      const now = asTimestamp(clock());
      transaction.update(ref, {
        orderCreationStatus: ORDER_CREATION_STATUS.ready,
        razorpayReceipt: expected.receipt,
        razorpayOrderId: order.id,
        razorpayOrderAmount: expected.amount,
        razorpayOrderCurrency: CURRENCY,
        orderCreationUpdatedAt: now,
        updatedAt: now,
      });
      return { ...registration, orderCreationStatus: ORDER_CREATION_STATUS.ready,
        razorpayReceipt: expected.receipt, razorpayOrderId: order.id,
        razorpayOrderAmount: expected.amount, razorpayOrderCurrency: CURRENCY };
    });
  }

  async function markOrderFailure(ref, attemptId) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data().orderCreationAttemptId !== attemptId) return;
      const now = asTimestamp(clock());
      transaction.update(ref, {
        orderCreationStatus: ORDER_CREATION_STATUS.failed,
        orderCreationUpdatedAt: now,
        updatedAt: now,
      });
    });
  }

  async function ensureOrder(ref, recoveryTokenHash, { requireOpen = false } = {}) {
    const claim = await db.runTransaction(async (transaction) => {
      let snapshot;
      if (requireOpen) {
        const [registrationSnapshot, configSnapshot] = await transaction.getAll(ref, registrationConfigRef);
        snapshot = registrationSnapshot;
        requireRegistrationOpen(configSnapshot);
      } else {
        snapshot = await transaction.get(ref);
      }
      if (!snapshot.exists) throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
      const registration = snapshot.data();
      if (!registrationHasRecoveryToken(registration, recoveryTokenHash)) {
        throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
      }
      if (
        registration.registrationStatus !== REGISTRATION_STATUS.paymentPending
        || registration.capacityReleased === true
        || registration.seatReservationExpiresAt?.toMillis() <= asTimestamp(clock()).toMillis()
      ) {
        throw new AppError('RESERVATION_EXPIRED', 'The seat reservation has expired.', 409);
      }
      if (registration.orderCreationStatus === ORDER_CREATION_STATUS.ready) {
        return { mode: 'ready', registration };
      }
      const previousStatus = registration.orderCreationStatus;
      if (previousStatus === ORDER_CREATION_STATUS.creating) {
        return {
          mode: 'recover-only',
          attemptId: registration.orderCreationAttemptId,
          receipt: registration.razorpayReceipt,
          amount: rupeesToPaise(registration.totalFee),
          registration,
        };
      }
      const attemptId = randomUUID();
      const now = asTimestamp(clock());
      const receipt = registration.registrationId;
      transaction.update(ref, {
        orderCreationStatus: ORDER_CREATION_STATUS.creating,
        orderCreationAttemptId: attemptId,
        razorpayReceipt: receipt,
        orderCreationUpdatedAt: now,
        updatedAt: now,
      });
      return {
        mode: 'create',
        attemptId,
        receipt,
        amount: rupeesToPaise(registration.totalFee),
        registration,
      };
    });

    if (claim.mode === 'ready') return claim.registration;
    const expected = {
      receipt: claim.receipt,
      amount: claim.amount,
      recoveryTokenHash,
    };
    let order = null;
    try {
      if (claim.mode === 'recover-only' || claim.registration.orderCreationStatus === ORDER_CREATION_STATUS.failed) {
        order = await razorpay.findOrderByReceipt(claim.receipt);
      }
      if (!order && claim.mode === 'recover-only') {
        throw new AppError('PAYMENT_ORDER_IN_PROGRESS', 'The payment order is still being prepared.', 409);
      }
      if (!order) {
        // A new-registration transaction and the external Razorpay request cannot be atomic.
        // Re-read the switch at the last possible point for that public creation path.
        if (requireOpen) await assertRegistrationOpen();
        order = await razorpay.createOrder({
          amount: claim.amount,
          currency: CURRENCY,
          receipt: claim.receipt,
          notes: { registrationId: claim.registration.registrationId },
        });
      }
      assertOrder(order, expected);
    } catch (error) {
      if (
        error instanceof AppError
        && (error.code === 'PAYMENT_ORDER_IN_PROGRESS' || error.code === 'REGISTRATION_CLOSED')
      ) throw error;
      try {
        order = await razorpay.findOrderByReceipt(claim.receipt);
        if (order) assertOrder(order, expected);
      } catch (recoveryError) {
        logger.error('Razorpay order recovery failed.', {
          registrationId: claim.registration.registrationId,
          operation: 'create_order',
          result: 'failed',
          error: recoveryError?.message,
        });
      }
      if (!order) {
        await markOrderFailure(ref, claim.attemptId);
        logger.error('Razorpay order creation failed.', {
          registrationId: claim.registration.registrationId,
          operation: 'create_order',
          result: 'failed',
          error: error?.message,
        });
        throw new AppError('PAYMENT_ORDER_FAILED', 'The payment order could not be created. Your seat remains reserved until the displayed expiry time.', 502);
      }
    }
    // For a new submission, do not expose an order if registration closed while Razorpay was responding.
    if (requireOpen) await assertRegistrationOpen();
    const associated = await associateOrder(ref, expected, order);
    if (
      associated.registrationStatus !== REGISTRATION_STATUS.paymentPending
      || associated.capacityReleased === true
      || associated.seatReservationExpiresAt?.toMillis() <= asTimestamp(clock()).toMillis()
    ) {
      await expireIfDue(ref, associated);
      throw new AppError('RESERVATION_EXPIRED', 'The seat reservation has expired.', 409);
    }
    return associated;
  }

  async function start(input, recoveryTokenHash) {
    const resumable = typeof createRegistration.findResumable === 'function'
      ? await createRegistration.findResumable(input)
      : null;
    let recovered = resumable && paymentService?.findCapturedForRegistrationRef
      ? await paymentService.findCapturedForRegistrationRef(resumable.ref)
      : null;
    let created;
    try {
      created = await createRegistration(input, { recoveryTokenHash });
    } catch (error) {
      if (
        recovered?.outcome === 'CAPTURED'
        && CAPACITY_ERRORS.has(error.code)
        && paymentService?.confirmFetchedPayment
      ) {
        await paymentService.confirmFetchedPayment(resumable.ref, recovered.payment, recovered.order, {
          source: 'RETRY_RECOVERY',
          registrationId: resumable.data.registrationId,
        });
        throw new AppError(
          'PAYMENT_REQUIRES_RECONCILIATION',
          'Payment was captured, but capacity is no longer available. Please contact the organizers.',
          409,
        );
      }
      throw error;
    }
    const ref = db.collection('registrations').doc(created.registrationDocId);
    if (await expireIfDue(ref, { ...created, capacityReleased: false })) {
      throw new AppError('RESERVATION_EXPIRED', 'The seat reservation has expired.', 409);
    }
    if (resumable && paymentService?.findCapturedForRegistrationRef) {
      if (recovered?.outcome !== 'CAPTURED') {
        recovered = await paymentService.findCapturedForRegistrationRef(ref);
      }
      if (recovered.outcome === 'CAPTURED') {
        const confirmed = await paymentService.confirmFetchedPayment(
          ref,
          recovered.payment,
          recovered.order,
          { source: 'RETRY_RECOVERY', registrationId: created.registrationId },
        );
        if (confirmed.outcome !== 'CONFIRMED') {
          throw new AppError(
            'PAYMENT_REQUIRES_RECONCILIATION',
            'The previous payment requires organizer reconciliation.',
            409,
          );
        }
        const refreshed = await ref.get();
        return participantResponse(refreshed.data(), razorpay.getPublicKeyId());
      }
      const refreshed = await ref.get();
      if (refreshed.data().paymentStatus === 'PAID') {
        throw new AppError('PAYMENT_REQUIRES_RECONCILIATION', 'The previous payment requires organizer reconciliation.', 409);
      }
    }
    const registration = await ensureOrder(ref, recoveryTokenHash, { requireOpen: true });
    return participantResponse(registration, razorpay.getPublicKeyId());
  }

  async function retry(registrationId, recoveryTokenHash) {
    const { ref, data } = await loadAuthorized(registrationId, recoveryTokenHash);
    if (data.registrationStatus !== REGISTRATION_STATUS.paymentPending || data.capacityReleased) {
      throw new AppError('RESERVATION_EXPIRED', 'The seat reservation has expired.', 409);
    }
    const registration = await ensureOrder(ref, recoveryTokenHash);
    return participantResponse(registration, razorpay.getPublicKeyId());
  }

  async function status(registrationId, recoveryTokenHash) {
    const result = registrationId
      ? await loadAuthorized(registrationId, recoveryTokenHash)
      : await findRegistrationByRecoveryToken(db, recoveryTokenHash);
    if (!registrationId && await expireIfDue(result.ref, result.data)) {
      const refreshed = await result.ref.get();
      result.data = refreshed.data();
    }
    const { data } = result;
    return participantResponse(data, razorpay.getPublicKeyId());
  }

  return { start, retry, status, participantResponse };
}
