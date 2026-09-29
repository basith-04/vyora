import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';
import {
  CHECKIN_TYPE, COLLECTIONS, PAYMENT_STATUS, REGISTRATION_STATUS, WORKSHOP_IDS,
} from '../config/constants.js';

function asTimestamp(now) {
  return Timestamp.fromMillis(typeof now === 'number' ? now : now.getTime());
}

function checkinDocumentId(type, workshopId, registrationDocId) {
  return createHash('sha256')
    .update(`vyora26:checkin:v1:${type}:${workshopId || '-'}:${registrationDocId}`)
    .digest('hex');
}

function iso(value) {
  return value?.toDate().toISOString();
}

function participantResult(registration, checkin, outcome) {
  return {
    outcome,
    type: checkin.type,
    workshopId: checkin.workshopId,
    checkedInAt: iso(checkin.checkedInAt),
    participant: {
      fullName: registration.fullName,
      registrationId: registration.registrationId,
      ieeeMember: registration.ieeeMember === true,
      workshopId: registration.workshopId,
    },
  };
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('INVALID_CHECKIN_REQUEST', 'Check-in data is required.', 400);
  }
  const allowed = new Set(['ticketToken', 'type', 'workshopId']);
  if (Object.keys(input).some((field) => !allowed.has(field))) {
    throw new AppError('INVALID_CHECKIN_REQUEST', 'The check-in request contains unsupported fields.', 400);
  }
  if (![CHECKIN_TYPE.event, CHECKIN_TYPE.workshop].includes(input.type)) {
    throw new AppError('INVALID_CHECKIN_TYPE', 'Select EVENT or WORKSHOP check-in.', 400);
  }
  if (input.type === CHECKIN_TYPE.workshop && !WORKSHOP_IDS.includes(input.workshopId)) {
    throw new AppError('WORKSHOP_REQUIRED', 'Select a valid workshop before scanning.', 400);
  }
  if (input.type === CHECKIN_TYPE.event && input.workshopId != null) {
    throw new AppError('INVALID_CHECKIN_REQUEST', 'Workshop must not be supplied for event check-in.', 400);
  }
  return { ticketToken: input.ticketToken, type: input.type, workshopId: input.workshopId ?? null };
}

export function createCheckinService({ db, ticketService, clock = () => Date.now() }) {
  return {
    async checkIn(input, admin, timings = {}) {
      if (!admin?.uid || !['ADMIN', 'COORDINATOR'].includes(admin.role)) {
        throw new AppError('FORBIDDEN', 'Authorized staff access is required.', 403);
      }
      const checked = validateInput(input);
      let ticket;
      const credentialStarted = performance.now();
      try { ticket = await ticketService.findByPayload(checked.ticketToken); }
      finally { timings.credentialMs = performance.now() - credentialStarted; }
      const registrationRef = db.collection(COLLECTIONS.registrations).doc(ticket.data.registrationDocId);
      const checkinRef = db.collection(COLLECTIONS.checkins).doc(
        checkinDocumentId(checked.type, checked.workshopId, ticket.data.registrationDocId),
      );

      const transactionStarted = performance.now();
      timings.transactionAttempts = 0;
      let result;
      try {
        result = await db.runTransaction(async (transaction) => {
          timings.transactionAttempts += 1;
          const [ticketSnapshot, registrationSnapshot, existingCheckinSnapshot] = await transaction.getAll(
            ticket.ref, registrationRef, checkinRef,
          );
          if (!ticketSnapshot.exists) throw new AppError('INVALID_TICKET', 'The ticket could not be found.', 404);
          const currentTicket = ticketSnapshot.data();
          if (currentTicket.qrTokenHash !== ticket.data.qrTokenHash
            || currentTicket.registrationDocId !== registrationRef.id || ticket.ref.id !== registrationRef.id) {
            throw new AppError('INVALID_TICKET', 'The ticket could not be found.', 404);
          }
          if (currentTicket.active !== true) {
            throw new AppError('TICKET_REVOKED', 'This ticket has been revoked.', 409);
          }
          if (!registrationSnapshot.exists) {
            throw new AppError('REGISTRATION_NOT_FOUND', 'The registration associated with this ticket is missing.', 409);
          }
          const registration = registrationSnapshot.data();
          if (
            registration.registrationStatus !== REGISTRATION_STATUS.confirmed
            || registration.paymentStatus !== PAYMENT_STATUS.paid
          ) {
            throw new AppError('REGISTRATION_NOT_CONFIRMED', 'This registration is not confirmed.', 409);
          }
          if (
            registration.ticketIssued !== true
            || registration.ticketId !== currentTicket.ticketId
            || currentTicket.registrationId !== registration.registrationId
          ) {
            throw new AppError('INVALID_TICKET', 'The ticket could not be found.', 404);
          }
          if (
            checked.type === CHECKIN_TYPE.workshop
            && registration.workshopId !== checked.workshopId
          ) {
            throw new AppError(
              'WORKSHOP_MISMATCH',
              'The participant is not registered for the selected workshop.',
              409,
              { registeredWorkshopId: registration.workshopId, selectedWorkshopId: checked.workshopId },
            );
          }
          if (existingCheckinSnapshot.exists) {
            return { registration, checkin: existingCheckinSnapshot.data(), outcome: 'ALREADY_CHECKED_IN' };
          }

          const checkin = {
            registrationDocId: registrationRef.id,
            registrationId: registration.registrationId,
            ticketId: currentTicket.ticketId,
            type: checked.type,
            workshopId: checked.type === CHECKIN_TYPE.workshop ? checked.workshopId : null,
            checkedInAt: asTimestamp(clock()),
            checkedInBy: admin.uid,
          };
          transaction.create(checkinRef, checkin);
          return { registration, checkin, outcome: 'CHECKED_IN' };
        });
      } finally { timings.transactionMs = performance.now() - transactionStarted; }
      return participantResult(result.registration, result.checkin, result.outcome);
    },
  };
}
