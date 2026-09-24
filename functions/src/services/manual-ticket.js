import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError, configurationError } from '../errors.js';
import { COLLECTIONS, PAYMENT_STATUS, REGISTRATION_STATUS, SYSTEM_DOCUMENTS } from '../config/constants.js';
import { validateAndNormalizeRegistration } from '../validation/registration.js';
import { calculatePricing } from './pricing.js';
import { duplicateLockIds } from './locks.js';
import { assertAvailableCapacity, assertCapacityDocument, assertWorkshopDocument, publicRegistrationId } from './registration.js';

function amountPaise(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AppError('INVALID_MANUAL_AMOUNT', 'Enter a positive manual amount.', 400);
  }
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(text)) {
    throw new AppError('INVALID_MANUAL_AMOUNT', 'Enter a positive INR amount with at most two decimal places.', 400);
  }
  const [rupees, fraction = ''] = text.split('.');
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise <= 0) {
    throw new AppError('INVALID_MANUAL_AMOUNT', 'Enter a positive manual amount.', 400);
  }
  return paise;
}

export function createManualTicketService({ db, ticketService, confirmationEmailService, clock = () => Date.now(), logger = console }) {
  async function create(input, admin) {
    if (admin?.role !== 'ADMIN' || !admin.uid) throw new AppError('FORBIDDEN', 'Administrator access is required.', 403);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['participant', 'manualAmount', 'idempotencyKey'].includes(key))) {
      throw new AppError('INVALID_PARTICIPANT_DATA', 'Manual ticket data is invalid.', 400);
    }
    const participant = validateAndNormalizeRegistration(input.participant);
    const collectedPaise = amountPaise(input.manualAmount);
    if (typeof input.idempotencyKey !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.idempotencyKey)) {
      throw new AppError('INVALID_IDEMPOTENCY_KEY', 'A valid submission key is required.', 400);
    }
    const documentId = createHash('sha256').update(`manual-ticket:${admin.uid}:${input.idempotencyKey}`).digest('hex').slice(0, 32);
    const fingerprint = createHash('sha256').update(JSON.stringify({ participant, collectedPaise })).digest('hex');
    const registrationRef = db.collection(COLLECTIONS.registrations).doc(documentId);
    const registrationId = publicRegistrationId(documentId);
    const capacityRef = db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.capacity);
    const configRef = db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.registrationConfig);
    const workshopRef = db.collection(COLLECTIONS.workshops).doc(participant.workshopId);
    const lockRefs = duplicateLockIds(participant).map((id) => db.collection(COLLECTIONS.registrationLocks).doc(id));
    const auditRef = db.collection(COLLECTIONS.auditLogs).doc();

    const outcome = await db.runTransaction(async (transaction) => {
      const [existing, configSnapshot, capacitySnapshot, workshopSnapshot, ...locks] = await transaction.getAll(
        registrationRef, configRef, capacityRef, workshopRef, ...lockRefs,
      );
      if (existing.exists) {
        const registration = existing.data();
        if (registration.manualTicketFingerprint !== fingerprint || registration.manualTicketCreatedBy !== admin.uid) {
          throw new AppError('IDEMPOTENCY_CONFLICT', 'This submission key was used for different ticket details.', 409);
        }
        return { registration, created: false };
      }
      if (!configSnapshot.exists || !capacitySnapshot.exists || !workshopSnapshot.exists) {
        throw configurationError('Registration storage has not been initialized.');
      }
      const capacity = capacitySnapshot.data();
      const workshop = workshopSnapshot.data();
      assertCapacityDocument(capacity);
      assertWorkshopDocument(workshop, participant.workshopId);
      if (locks.some((snapshot) => snapshot.exists && snapshot.data()?.status === 'ACTIVE')) {
        throw new AppError('DUPLICATE_REGISTRATION', 'An active registration already exists for this email or phone.', 409);
      }
      assertAvailableCapacity(capacity, workshop, participant);
      const nowValue = clock();
      const now = Timestamp.fromMillis(typeof nowValue === 'number' ? nowValue : nowValue.getTime());
      const pricing = calculatePricing(participant, configSnapshot.data().pricing);
      const registration = {
        registrationId, ...participant, ...pricing,
        paymentStatus: PAYMENT_STATUS.paid,
        registrationStatus: REGISTRATION_STATUS.confirmed,
        paymentMethod: 'MANUAL',
        manualPayments: [{ amountPaise: collectedPaise, reason: 'Manual ticket', collectedAt: now, recordedBy: admin.uid }],
        manualTicketFingerprint: fingerprint,
        manualTicketCreatedBy: admin.uid,
        seatReservationExpiresAt: null,
        capacityReleased: false,
        orderCreationStatus: null, orderCreationAttemptId: null, orderCreationUpdatedAt: null,
        razorpayReceipt: null, razorpayOrderId: null, razorpayOrderAmount: null,
        razorpayOrderCurrency: null, razorpayPaymentId: null,
        paymentReconciliationRequired: false,
        ticketIssued: false, ticketId: null,
        confirmationEmail: {
          status: 'PENDING', attempts: 0, sentAt: null, lastAttemptAt: null,
          lastErrorCode: null, providerMessageId: null, leaseExpiresAt: null,
        },
        createdAt: now, updatedAt: now, paymentCompletedAt: now, confirmedAt: now,
        expiredAt: null, cancelledAt: null,
      };
      transaction.create(registrationRef, registration);
      transaction.update(capacityRef, {
        eventOccupied: capacity.eventOccupied + 1,
        firstYearOccupied: capacity.firstYearOccupied + (participant.year === 1 ? 1 : 0),
        updatedAt: now,
      });
      transaction.update(workshopRef, { occupied: workshop.occupied + 1, updatedAt: now });
      for (const lockRef of lockRefs) transaction.set(lockRef, {
        registrationDocId: documentId, registrationId, status: 'ACTIVE', createdAt: now, updatedAt: now,
      });
      transaction.create(auditRef, {
        action: 'MANUAL_TICKET_CREATED', registrationDocId: documentId, registrationId,
        performedBy: admin.uid, metadata: { amountPaise: collectedPaise }, createdAt: now,
      });
      return { registration, created: true };
    });

    // Ticket issuance is idempotent and can be resumed with the same submission key.
    let issued;
    try {
      issued = await ticketService.issueForRegistrationRef(registrationRef);
    } catch (error) {
      logger.error('Manual ticket issuance failed.', { registrationId, code: error?.code || 'INTERNAL_ERROR' });
      throw new AppError('TICKET_ISSUANCE_RETRY', 'Registration was confirmed. Retry this submission to finish ticket issuance.', 503,
        { registrationId });
    }
    let emailStatus = 'PENDING';
    try {
      const email = await confirmationEmailService.sendForRegistrationRef(registrationRef, issued);
      emailStatus = email.outcome;
    } catch (error) {
      logger.error('Manual ticket email orchestration failed.', { registrationId, code: error?.code || 'INTERNAL_ERROR' });
      emailStatus = 'FAILED';
    }
    return {
      fullName: outcome.registration.fullName,
      registrationId,
      ticketId: issued.ticket.ticketId,
      manualAmountPaise: collectedPaise,
      confirmationEmailStatus: emailStatus,
      idempotent: !outcome.created,
    };
  }
  return { create };
}
