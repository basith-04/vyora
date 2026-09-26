import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError, configurationError } from '../errors.js';
import { COLLECTIONS, SYSTEM_DOCUMENTS } from '../config/constants.js';
import { validateAndNormalizeRegistration } from '../validation/registration.js';
import { duplicateLockIds } from './locks.js';
import { assertCapacityDocument, assertWorkshopDocument } from './registration.js';
import { appendManualPayment, assertManualPaymentHistory, validateManualPayment, validTicket } from './ticket-edit.js';

const PARTICIPANT_FIELDS = [
  'fullName', 'email', 'phone', 'year', 'department', 'class', 'ieeeMember',
  'ieeeMembershipId', 'isHosteller', 'hostel', 'needsStay', 'stayType', 'workshopId',
];

function participantOf(registration) {
  return Object.fromEntries(PARTICIPANT_FIELDS.map((field) => [field, registration[field] ?? null]));
}

function assertAdmin(admin) {
  if (admin?.role !== 'ADMIN' || !admin.uid) throw new AppError('FORBIDDEN', 'Administrator access is required.', 403);
}

function assertInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['requestId', 'expectedUpdatedAt', 'participant', 'manualPayment'].includes(key))
    || typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.requestId)
    || typeof input.expectedUpdatedAt !== 'string') {
    throw new AppError('INVALID_TICKET_TRANSFER', 'The transfer request is invalid.', 400);
  }
}

function detailOf(registration, ticket) {
  return {
    registrationId: registration.registrationId, ticketId: ticket.ticketId,
    participant: participantOf(registration),
    manualPayments: (registration.manualPayments || []).map((payment) => ({
      amountPaise: payment.amountPaise, reason: payment.reason,
      collectedAt: payment.collectedAt?.toDate?.().toISOString() || null,
      recordedBy: payment.recordedBy,
    })),
    updatedAt: registration.updatedAt?.toDate?.().toISOString() || null,
    confirmationEmailStatus: registration.confirmationEmail?.status || 'PENDING',
  };
}

export function createTicketTransferService({ db, ticketService, confirmationEmailService, clock = () => Date.now() }) {
  async function find(registrationId) {
    if (typeof registrationId !== 'string' || !/^VYR26-[A-Z0-9-]+$/.test(registrationId) || registrationId.length > 80) {
      throw new AppError('REGISTRATION_NOT_FOUND', 'Registration not found.', 404);
    }
    const matches = await db.collection(COLLECTIONS.registrations).where('registrationId', '==', registrationId).limit(2).get();
    if (matches.size !== 1) throw new AppError('REGISTRATION_NOT_FOUND', 'Registration not found.', 404);
    return matches.docs[0].ref;
  }

  async function detail(registrationId, admin) {
    assertAdmin(admin);
    const ref = await find(registrationId);
    const [registrationSnapshot, ticketSnapshot] = await Promise.all([
      ref.get(), db.collection(COLLECTIONS.tickets).doc(ref.id).get(),
    ]);
    const registration = registrationSnapshot.data();
    const ticket = ticketSnapshot.data();
    if (!registration || !validTicket(registration, ticket, ref.id)) {
      throw new AppError('TICKET_NOT_TRANSFERABLE', 'A valid confirmed ticket is required.', 409);
    }
    return detailOf(registration, ticket);
  }

  async function apply(registrationId, input, admin) {
    assertAdmin(admin);
    assertInput(input);
    const participant = validateAndNormalizeRegistration(input.participant);
    const manualPayment = Object.hasOwn(input, 'manualPayment') ? validateManualPayment(input.manualPayment) : null;
    const fingerprint = createHash('sha256').update(JSON.stringify({ participant, manualPayment })).digest('hex');
    const ref = await find(registrationId);
    const ticketRef = db.collection(COLLECTIONS.tickets).doc(ref.id);
    const auditRef = db.collection(COLLECTIONS.auditLogs).doc(`ticket_transfer_${input.requestId}`);
    const capacityRef = db.collection(COLLECTIONS.system).doc(SYSTEM_DOCUMENTS.capacity);
    const allLockIds = [...new Set(duplicateLockIds(participant))];
    const outcome = await db.runTransaction(async (transaction) => {
      const [auditSnapshot, registrationSnapshot, ticketSnapshot] = await transaction.getAll(auditRef, ref, ticketRef);
      if (auditSnapshot.exists) {
        const audit = auditSnapshot.data();
        if (audit.registrationDocId !== ref.id || audit.performedBy !== admin.uid || audit.metadata?.fingerprint !== fingerprint) {
          throw new AppError('IDEMPOTENCY_CONFLICT', 'This transfer request was already used.', 409);
        }
        if (ticketSnapshot.data()?.credentialVersion !== audit.metadata?.credentialVersion) {
          throw new AppError('TICKET_TRANSFER_STALE', 'This ticket was transferred again. Reload its current details.', 409);
        }
        return { idempotent: true };
      }
      const current = registrationSnapshot.data();
      const ticket = ticketSnapshot.data();
      if (!current || !validTicket(current, ticket, ref.id) || current.capacityReleased === true) {
        throw new AppError('TICKET_NOT_TRANSFERABLE', 'A valid confirmed ticket is required.', 409);
      }
      if (current.updatedAt?.toDate?.().toISOString() !== input.expectedUpdatedAt) {
        throw new AppError('TICKET_TRANSFER_STALE', 'The registration changed. Reload and review it again.', 409);
      }
      if (participant.email === current.email) {
        throw new AppError('TRANSFER_EMAIL_UNCHANGED', 'Use the new participant’s own email so the former holder cannot receive the transferred ticket.', 400);
      }
      assertManualPaymentHistory(current);
      if (current.confirmationEmail?.status === 'SENDING') {
        throw new AppError('TICKET_EMAIL_IN_PROGRESS', 'Wait for the current ticket email delivery to finish before transferring.', 409);
      }
      const checkins = await transaction.get(db.collection(COLLECTIONS.checkins)
        .where('registrationDocId', '==', ref.id).limit(1));
      if (!checkins.empty) {
        throw new AppError('TICKET_ALREADY_CHECKED_IN', 'A checked-in ticket cannot be transferred.', 409);
      }
      const oldIds = duplicateLockIds(current);
      const lockIds = [...new Set([...oldIds, ...allLockIds])];
      const lockRefs = lockIds.map((id) => db.collection(COLLECTIONS.registrationLocks).doc(id));
      const oldWorkshopRef = db.collection(COLLECTIONS.workshops).doc(current.workshopId);
      const newWorkshopRef = db.collection(COLLECTIONS.workshops).doc(participant.workshopId);
      const workshopRefs = current.workshopId === participant.workshopId ? [oldWorkshopRef] : [oldWorkshopRef, newWorkshopRef];
      const snapshots = await transaction.getAll(capacityRef, ...workshopRefs, ...lockRefs);
      const capacity = snapshots[0].data();
      const oldWorkshop = snapshots[1].data();
      const newWorkshop = current.workshopId === participant.workshopId ? oldWorkshop : snapshots[2].data();
      assertCapacityDocument(capacity);
      assertWorkshopDocument(oldWorkshop, current.workshopId);
      assertWorkshopDocument(newWorkshop, participant.workshopId);
      const lockSnapshots = snapshots.slice(1 + workshopRefs.length);
      const lockById = new Map(lockIds.map((id, index) => [id, lockSnapshots[index]]));
      for (const id of oldIds) {
        const lock = lockById.get(id)?.data();
        if (lock?.status !== 'ACTIVE' || lock.registrationDocId !== ref.id) {
          throw configurationError('The original duplicate locks do not match this registration.');
        }
      }
      for (const id of allLockIds) {
        const lock = lockById.get(id)?.data();
        if (lock?.status === 'ACTIVE' && lock.registrationDocId !== ref.id) {
          throw new AppError('DUPLICATE_REGISTRATION', id.startsWith('email_')
            ? 'The new email already belongs to an active registration.'
            : 'The new phone already belongs to an active registration.', 409);
        }
      }
      if (current.workshopId !== participant.workshopId) {
        if (oldWorkshop.occupied < 1) throw configurationError('Workshop counter cannot be transferred safely.');
        if (!newWorkshop.active) throw new AppError('WORKSHOP_UNAVAILABLE', 'The selected workshop is unavailable.', 409);
        if (newWorkshop.occupied >= newWorkshop.capacity) throw new AppError('WORKSHOP_FULL', 'The selected workshop is full.', 409);
      }
      const yearDelta = Number(participant.year === 1) - Number(current.year === 1);
      if (yearDelta > 0 && capacity.firstYearOccupied >= capacity.firstYearCapacity) {
        throw new AppError('FIRST_YEAR_FULL', 'First-year registration capacity is full.', 409);
      }
      if (yearDelta < 0 && capacity.firstYearOccupied < 1) throw configurationError('First-year counter cannot be transferred safely.');
      const rotated = ticketService.rotatedCredential(ref.id, ticket);
      const nowValue = clock();
      const now = Timestamp.fromMillis(typeof nowValue === 'number' ? nowValue : nowValue.getTime());
      transaction.update(ref, {
        ...participant, updatedAt: now,
        recoveryTokenHash: null, recoveryTokenHashes: [],
        ...(manualPayment ? { manualPayments: appendManualPayment(current, manualPayment, now, admin.uid) } : {}),
        confirmationEmail: {
          status: 'PENDING', attempts: 0, sentAt: null, lastAttemptAt: null,
          lastErrorCode: null, providerMessageId: null, leaseExpiresAt: null,
          deliveryVersion: rotated.credentialVersion,
        },
      });
      transaction.update(ticketRef, {
        credentialVersion: rotated.credentialVersion,
        qrTokenHash: rotated.hash,
        viewTokenHash: rotated.viewTokenHash,
      });
      if (yearDelta) transaction.update(capacityRef, { firstYearOccupied: capacity.firstYearOccupied + yearDelta, updatedAt: now });
      if (current.workshopId !== participant.workshopId) {
        transaction.update(oldWorkshopRef, { occupied: oldWorkshop.occupied - 1, updatedAt: now });
        transaction.update(newWorkshopRef, { occupied: newWorkshop.occupied + 1, updatedAt: now });
      }
      for (const id of oldIds) if (!allLockIds.includes(id)) transaction.delete(db.collection(COLLECTIONS.registrationLocks).doc(id));
      for (const id of allLockIds) {
        const snapshot = lockById.get(id);
        if (!snapshot.exists || snapshot.data()?.registrationDocId !== ref.id || snapshot.data()?.status !== 'ACTIVE') {
          transaction.set(db.collection(COLLECTIONS.registrationLocks).doc(id), {
            registrationDocId: ref.id, registrationId: current.registrationId,
            status: 'ACTIVE', createdAt: now, updatedAt: now,
          });
        }
      }
      transaction.create(auditRef, {
        action: 'TICKET_TRANSFER', registrationDocId: ref.id, registrationId: current.registrationId,
        performedBy: admin.uid, createdAt: now,
        metadata: { previous: participantOf(current), next: participant, manualPayment,
          previousCredentialVersion: ticket.credentialVersion || 0,
          credentialVersion: rotated.credentialVersion, fingerprint },
      });
      return { idempotent: false };
    });
    const issued = await ticketService.existingForRegistrationRef(ref);
    const email = await confirmationEmailService.sendForRegistrationRef(ref, issued, { allowRetry: true });
    return { ...await detail(registrationId, admin), idempotent: outcome.idempotent, emailOutcome: email.outcome };
  }

  return { detail, apply };
}
