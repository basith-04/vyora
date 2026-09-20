import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';
import {
  COLLECTIONS,
  PAYMENT_STATUS,
  REGISTRATION_STATUS,
  SYSTEM_DOCUMENTS,
} from '../config/constants.js';
import { duplicateLockIds } from './locks.js';
import {
  assertRemotePayment,
  mergeUnique,
  paymentDocument,
} from './payment.js';
import { assertCapacityDocument, assertWorkshopDocument } from './registration.js';

const SOURCE = 'ADMIN_RECONCILIATION';
const CURRENCY = 'INR';

function timestamp(clock) {
  const value = clock();
  return Timestamp.fromMillis(typeof value === 'number' ? value : value.getTime());
}

function capturedAt(payment, fallback) {
  if (Number.isSafeInteger(payment.created_at) && payment.created_at > 0) {
    return Timestamp.fromMillis(payment.created_at * 1000);
  }
  return fallback;
}

function normalizeRegistrationId(value) {
  const registrationId = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^VYR26-[A-Z0-9]+$/.test(registrationId) || registrationId.length > 80) {
    throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
  }
  return registrationId;
}

function remoteError(error, registrationId, logger) {
  logger.error('Razorpay manual reconciliation fetch failed.', {
    registrationId,
    operation: 'manual_payment_reconciliation',
    result: 'failed',
    code: error?.code || 'RAZORPAY_FETCH_FAILED',
  });
  return new AppError(
    'PAYMENT_VERIFICATION_FAILED',
    'Razorpay could not be reached to verify this payment. Try again later.',
    502,
  );
}

function assertRegistrationOrder(registration, order) {
  const expectedAmount = registration.totalFee * 100;
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0) {
    throw new AppError('NOT_ELIGIBLE_FOR_RECONCILIATION', 'The registration does not have valid authoritative pricing.', 409);
  }
  if (order.id !== registration.razorpayOrderId || order.receipt !== registration.registrationId) {
    throw new AppError('PAYMENT_ORDER_MISMATCH', 'The Razorpay order does not belong to this registration.', 409);
  }
  if (registration.razorpayOrderAmount !== expectedAmount || order.amount !== expectedAmount) {
    throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'The Razorpay amount does not match the registration total.', 409);
  }
  if (registration.razorpayOrderCurrency !== CURRENCY || order.currency !== CURRENCY) {
    throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'The Razorpay currency does not match the registration currency.', 409);
  }
}

function selectCapturedPayment(registration, listedPayments, fetchedPayment) {
  const byId = new Map();
  for (const payment of [...listedPayments, ...(fetchedPayment ? [fetchedPayment] : [])]) {
    if (payment?.id) byId.set(payment.id, payment);
  }
  const payments = [...byId.values()];
  const captured = payments.filter((payment) => payment.status === 'captured' && payment.captured === true);

  if (captured.length > 1) {
    throw new AppError(
      'AMBIGUOUS_PAYMENT',
      'Multiple captured Razorpay payments were found. Manual investigation is required.',
      409,
      { capturedPaymentCount: captured.length },
    );
  }
  if (captured.length === 0) {
    if (payments.some((payment) => payment.status === 'authorized')) {
      throw new AppError('PAYMENT_NOT_CAPTURED', 'The Razorpay payment is authorized but has not been captured.', 409);
    }
    throw new AppError('NO_CAPTURED_PAYMENT', 'No valid captured Razorpay payment was found for this registration.', 409);
  }

  const payment = captured[0];
  if (registration.razorpayPaymentId && payment.id !== registration.razorpayPaymentId) {
    throw new AppError(
      'AMBIGUOUS_PAYMENT',
      'The captured payment conflicts with the payment already recorded locally. Manual investigation is required.',
      409,
    );
  }
  return payment;
}

function capacityFailure(capacity, workshop, registration) {
  if (capacity.eventOccupied >= capacity.eventCapacity) return 'EVENT_FULL';
  if (registration.year === 1 && capacity.firstYearOccupied >= capacity.firstYearCapacity) return 'FIRST_YEAR_FULL';
  if (workshop.occupied >= workshop.capacity) return 'WORKSHOP_FULL';
  if (workshop.active !== true) return 'WORKSHOP_UNAVAILABLE';
  return null;
}

export function createManualReconciliationService({
  db,
  razorpay,
  ticketService = null,
  confirmationEmailService = null,
  clock = () => Date.now(),
  logger = console,
}) {
  async function findRegistration(registrationId) {
    const snapshot = await db.collection(COLLECTIONS.registrations)
      .where('registrationId', '==', normalizeRegistrationId(registrationId))
      .limit(2)
      .get();
    if (snapshot.size !== 1) {
      throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
    }
    return { ref: snapshot.docs[0].ref, data: snapshot.docs[0].data() };
  }

  async function fetchVerifiedPayment(registration) {
    if (!registration.razorpayOrderId) {
      throw new AppError('NO_RAZORPAY_ORDER', 'This registration does not have a Razorpay order.', 409);
    }
    let order;
    let listed;
    let fetched = null;
    try {
      [order, listed, fetched] = await Promise.all([
        razorpay.fetchOrder(registration.razorpayOrderId),
        razorpay.fetchPaymentsForOrder(registration.razorpayOrderId),
        registration.razorpayPaymentId
          ? razorpay.fetchPayment(registration.razorpayPaymentId)
          : Promise.resolve(null),
      ]);
    } catch (error) {
      throw remoteError(error, registration.registrationId, logger);
    }

    assertRegistrationOrder(registration, order);
    const payment = selectCapturedPayment(registration, Array.isArray(listed?.items) ? listed.items : [], fetched);
    if (payment.order_id !== registration.razorpayOrderId) {
      throw new AppError('PAYMENT_ORDER_MISMATCH', 'The captured payment belongs to a different Razorpay order.', 409);
    }
    if (payment.amount !== registration.razorpayOrderAmount || payment.currency !== CURRENCY) {
      throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'The captured payment amount or currency does not match.', 409);
    }
    try {
      assertRemotePayment(registration, payment, order);
    } catch (error) {
      if (error.code === 'PAYMENT_AMOUNT_MISMATCH') throw error;
      if (payment.status !== 'captured' || payment.captured !== true) {
        throw new AppError('PAYMENT_NOT_CAPTURED', 'The Razorpay payment has not been captured.', 409);
      }
      throw new AppError('PAYMENT_ORDER_MISMATCH', 'The Razorpay payment/order relationship is invalid.', 409);
    }
    return { payment, order };
  }

  async function reconcile(registrationId, admin) {
    if (admin?.role !== 'ADMIN' || !admin.uid) {
      throw new AppError('FORBIDDEN', 'Administrator access is required for this operation.', 403);
    }
    const found = await findRegistration(registrationId);
    const initial = found.data;
    if (initial.registrationStatus === 'CANCELLED') {
      throw new AppError('NOT_ELIGIBLE_FOR_RECONCILIATION', 'Cancelled registrations cannot be reconciled automatically.', 409);
    }
    const { payment } = await fetchVerifiedPayment(initial);
    const associatedRegistrations = await db.collection(COLLECTIONS.registrations)
      .where('razorpayPaymentId', '==', payment.id)
      .limit(2)
      .get();
    if (associatedRegistrations.docs.some((snapshot) => snapshot.ref.path !== found.ref.path)) {
      throw new AppError('PAYMENT_ALREADY_USED', 'This Razorpay payment is already associated with another registration.', 409);
    }
    const paymentRef = db.collection(COLLECTIONS.payments).doc(payment.id);
    const capacityRef = db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.capacity);
    const workshopRef = db.collection(COLLECTIONS.workshops).doc(initial.workshopId);
    const lockRefs = duplicateLockIds(initial).map((id) => db.collection(COLLECTIONS.registrationLocks).doc(id));

    const result = await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(
        found.ref,
        paymentRef,
        capacityRef,
        workshopRef,
        ...lockRefs,
      );
      const [registrationSnapshot, paymentSnapshot, capacitySnapshot, workshopSnapshot, ...lockSnapshots] = snapshots;
      if (!registrationSnapshot.exists) {
        throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
      }
      if (!capacitySnapshot.exists || !workshopSnapshot.exists) {
        throw new AppError('INTERNAL_ERROR', 'Capacity storage is not configured correctly.', 500);
      }
      const current = registrationSnapshot.data();
      const capacity = capacitySnapshot.data();
      const workshop = workshopSnapshot.data();
      assertCapacityDocument(capacity);
      assertWorkshopDocument(workshop, current.workshopId);

      if (
        current.razorpayOrderId !== payment.order_id
        || current.razorpayOrderAmount !== payment.amount
        || current.razorpayOrderCurrency !== payment.currency
      ) {
        throw new AppError('PAYMENT_ORDER_MISMATCH', 'The registration changed while the payment was being verified.', 409);
      }
      const existingPayment = paymentSnapshot.data();
      if (existingPayment && existingPayment.registrationId !== current.registrationId) {
        throw new AppError('PAYMENT_ALREADY_USED', 'This Razorpay payment is already associated with another registration.', 409);
      }
      if (existingPayment && (
        existingPayment.razorpayPaymentId !== payment.id
        || existingPayment.razorpayOrderId !== payment.order_id
        || existingPayment.amount !== payment.amount
        || existingPayment.currency !== payment.currency
      )) {
        throw new AppError('PAYMENT_ALREADY_USED', 'The existing payment record conflicts with Razorpay.', 409);
      }
      if (current.registrationStatus === 'CANCELLED') {
        throw new AppError('NOT_ELIGIBLE_FOR_RECONCILIATION', 'Cancelled registrations cannot be reconciled automatically.', 409);
      }
      const now = timestamp(clock);
      const paymentTime = current.paymentCompletedAt || capturedAt(payment, now);
      const basePayment = existingPayment
        ?? paymentDocument(payment, found.ref.id, current, SOURCE, null, now, false);
      const paymentUpdate = {
        ...basePayment,
        sources: mergeUnique(basePayment.sources, SOURCE),
        status: 'CAPTURED',
        verifiedAt: basePayment.verifiedAt || now,
        updatedAt: now,
      };

      if (current.registrationStatus === REGISTRATION_STATUS.confirmed) {
        if (current.paymentStatus !== PAYMENT_STATUS.paid || current.razorpayPaymentId !== payment.id) {
          throw new AppError('PAYMENT_ALREADY_USED', 'The confirmed registration is associated with a different payment.', 409);
        }
        transaction.set(paymentRef, {
          ...paymentUpdate,
          reconciliationRequired: false,
          reconciliationReason: null,
        }, { merge: true });
        return {
          outcome: 'ALREADY_CONFIRMED',
          registrationId: current.registrationId,
          registrationStatus: current.registrationStatus,
          paymentStatus: current.paymentStatus,
          razorpayPaymentId: payment.id,
          idempotent: true,
        };
      }

      let failure = null;
      const needsAllocation = current.capacityReleased === true;
      if (needsAllocation) {
        failure = capacityFailure(capacity, workshop, current);
        if (!failure) {
          const conflictingLock = lockSnapshots.find((snapshot) => (
            snapshot.exists
            && snapshot.data()?.status === 'ACTIVE'
            && snapshot.data()?.registrationDocId !== found.ref.id
          ));
          if (conflictingLock) failure = 'DUPLICATE_REGISTRATION';
        }
      }

      if (failure) {
        transaction.set(paymentRef, {
          ...paymentUpdate,
          reconciliationRequired: true,
          reconciliationReason: failure,
        }, { merge: true });
        transaction.update(found.ref, {
          paymentStatus: PAYMENT_STATUS.paid,
          razorpayPaymentId: payment.id,
          paymentCompletedAt: paymentTime,
          paymentReconciliationRequired: true,
          manualReconciliationLastAttemptAt: now,
          manualReconciliationLastAttemptBy: admin.uid,
          updatedAt: now,
        });
        return {
          outcome: 'PAYMENT_VERIFIED_NO_CAPACITY',
          reason: failure,
          registrationId: current.registrationId,
          registrationStatus: current.registrationStatus,
          paymentStatus: PAYMENT_STATUS.paid,
          razorpayPaymentId: payment.id,
          idempotent: false,
        };
      }

      transaction.set(paymentRef, {
        ...paymentUpdate,
        reconciliationRequired: false,
        reconciliationReason: null,
      }, { merge: true });
      transaction.update(found.ref, {
        paymentStatus: PAYMENT_STATUS.paid,
        registrationStatus: REGISTRATION_STATUS.confirmed,
        razorpayPaymentId: payment.id,
        paymentCompletedAt: paymentTime,
        confirmedAt: current.confirmedAt || now,
        paymentReconciliationRequired: false,
        capacityReleased: false,
        manuallyReconciledAt: now,
        manuallyReconciledBy: admin.uid,
        updatedAt: now,
      });

      if (needsAllocation) {
        transaction.update(capacityRef, {
          eventOccupied: capacity.eventOccupied + 1,
          firstYearOccupied: capacity.firstYearOccupied + (current.year === 1 ? 1 : 0),
          updatedAt: now,
        });
        transaction.update(workshopRef, { occupied: workshop.occupied + 1, updatedAt: now });
        for (const lockRef of lockRefs) {
          transaction.set(lockRef, {
            registrationDocId: found.ref.id,
            registrationId: current.registrationId,
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      return {
        outcome: 'CONFIRMED',
        registrationId: current.registrationId,
        registrationStatus: REGISTRATION_STATUS.confirmed,
        paymentStatus: PAYMENT_STATUS.paid,
        razorpayPaymentId: payment.id,
        capacityAllocated: needsAllocation,
        idempotent: false,
      };
    });

    if (['CONFIRMED', 'ALREADY_CONFIRMED'].includes(result.outcome) && ticketService) {
      let issued;
      try {
        issued = await ticketService.issueForRegistrationRef(found.ref);
        result.ticketIssued = Boolean(issued.ticket);
      } catch (error) {
        logger.error('Ticket issuance after manual reconciliation failed.', {
          registrationId: initial.registrationId,
          operation: 'manual_reconciliation_issue_ticket',
          result: 'failed',
          code: error?.code || 'INTERNAL_ERROR',
        });
        result.ticketIssued = false;
      }
      if (issued?.ticket && confirmationEmailService) {
        try {
          const email = await confirmationEmailService.sendForRegistrationRef(found.ref, issued);
          result.confirmationEmailStatus = email.outcome;
        } catch (error) {
          logger.error('Confirmation email after manual reconciliation failed.', {
            registrationId: initial.registrationId,
            operation: 'manual_reconciliation_send_email',
            result: 'failed',
            code: error?.code || 'INTERNAL_ERROR',
          });
          result.confirmationEmailStatus = 'FAILED';
        }
      }
    }
    return result;
  }

  return { reconcile };
}
