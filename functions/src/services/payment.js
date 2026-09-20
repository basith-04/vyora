import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';
import {
  COLLECTIONS,
  PAYMENT_STATUS,
  REGISTRATION_STATUS,
} from '../config/constants.js';
import { getAuthorizedRegistration } from './registration-access.js';
import { verifyCheckoutSignature } from './signatures.js';

const CURRENCY = 'INR';

function asTimestamp(now) {
  return Timestamp.fromMillis(typeof now === 'number' ? now : now.getTime());
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 200) {
    throw new AppError('PAYMENT_VERIFICATION_FAILED', `A valid ${field} is required.`, 400);
  }
  return value;
}

function mergeUnique(values = [], value) {
  return value && !values.includes(value) ? [...values, value] : values;
}

function paymentDocument(payment, registrationDocId, registration, source, eventId, now, reconciliationRequired) {
  return {
    registrationDocId,
    registrationId: registration.registrationId,
    razorpayOrderId: payment.order_id,
    razorpayPaymentId: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status.toUpperCase(),
    sources: [source],
    webhookEventIds: eventId ? [eventId] : [],
    reconciliationRequired,
    reconciliationReason: null,
    createdAt: now,
    verifiedAt: payment.status === 'captured' ? now : null,
    updatedAt: now,
  };
}

function assertRemotePayment(registration, payment, order) {
  if (payment.order_id !== registration.razorpayOrderId || order.id !== registration.razorpayOrderId) {
    throw new AppError('PAYMENT_VERIFICATION_FAILED', 'The payment does not belong to this registration.', 409);
  }
  if (payment.amount !== registration.razorpayOrderAmount || order.amount !== registration.razorpayOrderAmount) {
    throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'The paid amount does not match the registration amount.', 409);
  }
  if (payment.currency !== CURRENCY || order.currency !== CURRENCY) {
    throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'The payment currency does not match the registration currency.', 409);
  }
  if (payment.status !== 'captured' || payment.captured !== true || order.status !== 'paid') {
    throw new AppError('PAYMENT_VERIFICATION_FAILED', 'The payment has not been captured successfully.', 409);
  }
  if (order.receipt !== registration.registrationId) {
    throw new AppError('PAYMENT_VERIFICATION_FAILED', 'The payment order association is invalid.', 409);
  }
}

export function createPaymentService({
  db,
  razorpay,
  getKeySecret,
  ticketService = null,
  clock = () => Date.now(),
  logger = console,
}) {
  async function recordExceptionalPayment(ref, registration, payment, source, eventId, reason) {
    const paymentRef = db.collection(COLLECTIONS.payments).doc(payment.id);
    const result = await db.runTransaction(async (transaction) => {
      const [registrationSnapshot, existingPaymentSnapshot] = await transaction.getAll(ref, paymentRef);
      if (!registrationSnapshot.exists) {
        throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
      }
      const current = registrationSnapshot.data();
      const now = asTimestamp(clock());
      const existing = existingPaymentSnapshot.data();
      if (existing && existing.registrationId !== current.registrationId) {
        throw new AppError('PAYMENT_REQUIRES_RECONCILIATION', 'This payment requires organizer reconciliation.', 409);
      }
      const paymentData = existing ?? paymentDocument(payment, ref.id, current, source, eventId, now, true);
      transaction.set(paymentRef, {
        ...paymentData,
        sources: mergeUnique(paymentData.sources, source),
        webhookEventIds: mergeUnique(paymentData.webhookEventIds, eventId),
        status: payment.status.toUpperCase(),
        reconciliationRequired: true,
        reconciliationReason: reason,
        updatedAt: now,
      }, { merge: true });
      const registrationUpdate = {
        paymentReconciliationRequired: true,
        updatedAt: now,
      };
      if (
        payment.status === 'captured'
        && current.registrationStatus !== REGISTRATION_STATUS.confirmed
      ) {
        registrationUpdate.paymentStatus = PAYMENT_STATUS.paid;
        registrationUpdate.razorpayPaymentId = payment.id;
        registrationUpdate.paymentCompletedAt = now;
      }
      transaction.update(ref, registrationUpdate);
      return { outcome: 'RECONCILIATION_REQUIRED', registrationStatus: current.registrationStatus };
    });
    return result;
  }

  async function confirmFetchedPayment(ref, payment, order, { source, eventId = null }) {
    const registrationSnapshot = await ref.get();
    if (!registrationSnapshot.exists) {
      throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
    }
    const registration = registrationSnapshot.data();
    try {
      assertRemotePayment(registration, payment, order);
    } catch (error) {
      if (payment.status === 'captured' && ['PAYMENT_AMOUNT_MISMATCH', 'PAYMENT_VERIFICATION_FAILED'].includes(error.code)) {
        await recordExceptionalPayment(ref, registration, payment, source, eventId, error.code);
      }
      throw error;
    }

    const paymentRef = db.collection(COLLECTIONS.payments).doc(payment.id);
    const result = await db.runTransaction(async (transaction) => {
      const [currentSnapshot, existingPaymentSnapshot] = await transaction.getAll(ref, paymentRef);
      if (!currentSnapshot.exists) {
        throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
      }
      const current = currentSnapshot.data();
      if (current.razorpayOrderId !== payment.order_id) {
        throw new AppError('PAYMENT_VERIFICATION_FAILED', 'The payment does not belong to this registration.', 409);
      }
      const existingPayment = existingPaymentSnapshot.data();
      if (existingPayment && existingPayment.registrationId !== current.registrationId) {
        throw new AppError('PAYMENT_REQUIRES_RECONCILIATION', 'This payment requires organizer reconciliation.', 409);
      }
      const now = asTimestamp(clock());
      const basePayment = existingPayment
        ?? paymentDocument(payment, ref.id, current, source, eventId, now, false);
      const paymentUpdate = {
        ...basePayment,
        sources: mergeUnique(basePayment.sources, source),
        webhookEventIds: mergeUnique(basePayment.webhookEventIds, eventId),
        status: payment.status.toUpperCase(),
        updatedAt: now,
      };

      if (current.registrationStatus === REGISTRATION_STATUS.confirmed) {
        if (current.razorpayPaymentId !== payment.id) {
          paymentUpdate.reconciliationRequired = true;
          paymentUpdate.reconciliationReason = 'ADDITIONAL_PAYMENT';
          transaction.set(paymentRef, paymentUpdate, { merge: true });
          transaction.update(ref, { paymentReconciliationRequired: true, updatedAt: now });
          return { outcome: 'RECONCILIATION_REQUIRED', registrationStatus: current.registrationStatus };
        }
        transaction.set(paymentRef, paymentUpdate, { merge: true });
        return { outcome: 'CONFIRMED', registrationStatus: current.registrationStatus, idempotent: true };
      }

      if (
        current.registrationStatus !== REGISTRATION_STATUS.paymentPending
        || current.capacityReleased === true
      ) {
        paymentUpdate.reconciliationRequired = true;
        paymentUpdate.reconciliationReason = 'RESERVATION_EXPIRED';
        transaction.set(paymentRef, paymentUpdate, { merge: true });
        transaction.update(ref, {
          paymentStatus: PAYMENT_STATUS.paid,
          razorpayPaymentId: payment.id,
          paymentCompletedAt: now,
          paymentReconciliationRequired: true,
          updatedAt: now,
        });
        return { outcome: 'RECONCILIATION_REQUIRED', registrationStatus: current.registrationStatus };
      }

      // Expiration and confirmation both update this document transactionally.
      // Whichever commits first wins; confirmation never increments capacity.
      transaction.set(paymentRef, paymentUpdate, { merge: true });
      transaction.update(ref, {
        paymentStatus: PAYMENT_STATUS.paid,
        registrationStatus: REGISTRATION_STATUS.confirmed,
        razorpayPaymentId: payment.id,
        paymentCompletedAt: now,
        confirmedAt: now,
        paymentReconciliationRequired: false,
        updatedAt: now,
      });
      return { outcome: 'CONFIRMED', registrationStatus: REGISTRATION_STATUS.confirmed, idempotent: false };
    });
    if (result.outcome === 'CONFIRMED' && ticketService) {
      try {
        const issued = await ticketService.issueForRegistrationRef(ref);
        result.ticketIssued = Boolean(issued.ticket);
      } catch (error) {
        // Payment truth is already committed. Ticket issuance is independently retryable.
        logger.error('Ticket issuance after payment confirmation failed.', {
          registrationId: registration.registrationId,
          operation: 'issue_ticket',
          result: 'failed',
          code: error?.code || 'INTERNAL_ERROR',
        });
        result.ticketIssued = false;
      }
    }
    return result;
  }

  async function fetchAndConfirm(ref, paymentId, context) {
    let payment;
    let order;
    try {
      payment = await razorpay.fetchPayment(paymentId);
      order = await razorpay.fetchOrder(payment.order_id);
    } catch (error) {
      logger.error('Razorpay payment fetch failed.', {
        registrationId: context.registrationId,
        razorpayPaymentId: paymentId,
        operation: 'verify_payment',
        result: 'failed',
        error: error?.message,
      });
      throw new AppError('PAYMENT_VERIFICATION_FAILED', 'The payment could not be verified.', 502);
    }
    return confirmFetchedPayment(ref, payment, order, context);
  }

  async function verifyFromFrontend(input, recoveryTokenHash) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new AppError('PAYMENT_VERIFICATION_FAILED', 'Payment verification data is required.', 400);
    }
    const allowed = new Set(['registrationId', 'razorpayOrderId', 'razorpayPaymentId', 'razorpaySignature']);
    if (Object.keys(input).some((field) => !allowed.has(field))) {
      throw new AppError('PAYMENT_VERIFICATION_FAILED', 'Payment verification data contains unsupported fields.', 400);
    }
    const registrationId = requiredString(input.registrationId, 'registration ID');
    const orderId = requiredString(input.razorpayOrderId, 'order ID');
    const paymentId = requiredString(input.razorpayPaymentId, 'payment ID');
    const signature = requiredString(input.razorpaySignature, 'payment signature');
    const { ref, data: registration } = await getAuthorizedRegistration(db, registrationId, recoveryTokenHash);
    if (registration.razorpayOrderId !== orderId) {
      throw new AppError('PAYMENT_VERIFICATION_FAILED', 'The payment order does not belong to this registration.', 409);
    }
    if (!verifyCheckoutSignature({ orderId: registration.razorpayOrderId, paymentId, signature, secret: getKeySecret() })) {
      throw new AppError('PAYMENT_SIGNATURE_INVALID', 'The payment signature is invalid.', 400);
    }
    const result = await fetchAndConfirm(ref, paymentId, {
      source: 'FRONTEND', registrationId,
    });
    if (result.outcome === 'RECONCILIATION_REQUIRED') {
      throw new AppError('PAYMENT_REQUIRES_RECONCILIATION', 'Payment was received after the seat reservation could be confirmed. Please contact the organizers.', 409);
    }
    return {
      registrationId,
      registrationStatus: REGISTRATION_STATUS.confirmed,
      paymentStatus: PAYMENT_STATUS.paid,
      idempotent: result.idempotent,
      ticketIssued: result.ticketIssued === true,
    };
  }

  async function findByOrderId(orderId) {
    const snapshot = await db.collection(COLLECTIONS.registrations)
      .where('razorpayOrderId', '==', orderId)
      .limit(1)
      .get();
    if (snapshot.empty) {
      throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
    }
    return { ref: snapshot.docs[0].ref, data: snapshot.docs[0].data() };
  }

  async function processCapturedWebhook({ paymentId, orderId, eventId }) {
    requiredString(paymentId, 'payment ID');
    requiredString(orderId, 'order ID');
    const registration = await findByOrderId(orderId);
    const result = await fetchAndConfirm(registration.ref, paymentId, {
      source: 'WEBHOOK', eventId, registrationId: registration.data.registrationId,
    });
    return result;
  }

  async function recordFailedWebhook({ payment, eventId }) {
    if (!payment?.id || !payment?.order_id) return { outcome: 'IGNORED' };
    const registration = await findByOrderId(payment.order_id);
    const paymentRef = db.collection(COLLECTIONS.payments).doc(payment.id);
    await db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(paymentRef);
      const now = asTimestamp(clock());
      const existing = existingSnapshot.data();
      transaction.set(paymentRef, {
        registrationDocId: registration.ref.id,
        registrationId: registration.data.registrationId,
        razorpayOrderId: payment.order_id,
        razorpayPaymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: 'FAILED',
        sources: mergeUnique(existing?.sources ?? [], 'WEBHOOK'),
        webhookEventIds: mergeUnique(existing?.webhookEventIds ?? [], eventId),
        reconciliationRequired: false,
        reconciliationReason: null,
        createdAt: existing?.createdAt ?? now,
        verifiedAt: null,
        updatedAt: now,
      }, { merge: true });
    });
    return { outcome: 'RECORDED' };
  }

  return {
    verifyFromFrontend,
    processCapturedWebhook,
    recordFailedWebhook,
    confirmFetchedPayment,
  };
}
