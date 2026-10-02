import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';
import {
  CHECKIN_TYPE, CHECKOUT_GROUP, COLLECTIONS, HOSTELS, WORKSHOP_IDS,
} from '../config/constants.js';
import { isPaidConfirmed } from './ticket.js';

const CHECKOUT_TYPES = new Set([CHECKIN_TYPE.day1Checkout, CHECKIN_TYPE.day2Checkout]);
const TYPES = new Set(Object.values(CHECKIN_TYPE));

export function accommodationGroup(registration) {
  if (registration.isHosteller === true && HOSTELS.includes(registration.hostel)) return registration.hostel;
  if (registration.isHosteller === false && registration.needsStay === true) return CHECKOUT_GROUP.stay;
  return null;
}

function assertStaff(admin) {
  if (!admin?.uid || !['ADMIN', 'COORDINATOR'].includes(admin.role)) {
    throw new AppError('FORBIDDEN', 'Authorized staff access is required.', 403);
  }
}

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

function validateSelection(input, scan = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('INVALID_CHECKIN_REQUEST', 'Check-in data is required.', 400);
  }
  const allowed = new Set(scan ? ['ticketToken', 'type', 'workshopId', 'accommodationGroup'] : ['type', 'workshopId', 'accommodationGroup']);
  if (Object.keys(input).some((field) => !allowed.has(field))) {
    throw new AppError('INVALID_CHECKIN_REQUEST', 'The check-in request contains unsupported fields.', 400);
  }
  if (!TYPES.has(input.type)) {
    throw new AppError('INVALID_CHECKIN_TYPE', 'Select a valid attendance checkpoint.', 400);
  }
  if (input.type === CHECKIN_TYPE.workshop && !WORKSHOP_IDS.includes(input.workshopId)) {
    throw new AppError('WORKSHOP_REQUIRED', 'Select a valid workshop before scanning.', 400);
  }
  if (input.type !== CHECKIN_TYPE.workshop && input.workshopId != null) {
    throw new AppError('INVALID_CHECKIN_REQUEST', 'Workshop must not be supplied for event check-in.', 400);
  }
  if (CHECKOUT_TYPES.has(input.type)) {
    if (![CHECKOUT_GROUP.all, CHECKOUT_GROUP.stay, ...HOSTELS].includes(input.accommodationGroup)) {
      throw new AppError('ACCOMMODATION_GROUP_REQUIRED', 'Select a valid accommodation group.', 400);
    }
  } else if (input.accommodationGroup != null) {
    throw new AppError('INVALID_CHECKIN_REQUEST', 'Accommodation group is only valid for checkout.', 400);
  }
  return { ticketToken: input.ticketToken, type: input.type, workshopId: input.workshopId ?? null,
    accommodationGroup: input.accommodationGroup ?? null };
}

export function createCheckinService({ db, ticketService, clock = () => Date.now() }) {
  return {
    async checkIn(input, admin, timings = {}) {
      assertStaff(admin);
      const checked = validateSelection(input, true);
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
          if (!isPaidConfirmed(registration)) {
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
          if (CHECKOUT_TYPES.has(checked.type) && checked.accommodationGroup !== CHECKOUT_GROUP.all
            && accommodationGroup(registration) !== checked.accommodationGroup) {
            throw new AppError('ACCOMMODATION_GROUP_MISMATCH', 'Participant belongs to a different accommodation group.', 409,
              { registeredGroup: accommodationGroup(registration), selectedGroup: checked.accommodationGroup });
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
    async summary(input, admin) {
      assertStaff(admin);
      const selected = validateSelection(input);
      const [registrationsSnapshot, checkinsSnapshot] = await Promise.all([
        db.collection(COLLECTIONS.registrations).get(),
        db.collection(COLLECTIONS.checkins).where('type', '==', selected.type).get(),
      ]);
      const attended = new Set(checkinsSnapshot.docs
        .filter((doc) => selected.type !== CHECKIN_TYPE.workshop || doc.data().workshopId === selected.workshopId)
        .map((doc) => doc.data().registrationDocId));
      let expected = 0;
      let scanned = 0;
      const remaining = [];
      for (const doc of registrationsSnapshot.docs) {
        const registration = doc.data();
        if (!isPaidConfirmed(registration)) continue;
        if (selected.type === CHECKIN_TYPE.workshop && registration.workshopId !== selected.workshopId) continue;
        if (CHECKOUT_TYPES.has(selected.type) && selected.accommodationGroup !== CHECKOUT_GROUP.all
          && accommodationGroup(registration) !== selected.accommodationGroup) continue;
        expected += 1;
        if (attended.has(doc.id)) { scanned += 1; continue; }
        remaining.push({ fullName: registration.fullName, registrationId: registration.registrationId,
          ...(selected.type === CHECKIN_TYPE.workshop ? { workshopId: registration.workshopId } : {}),
          ...(CHECKOUT_TYPES.has(selected.type) ? { accommodationGroup: accommodationGroup(registration) } : {}) });
      }
      remaining.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.registrationId.localeCompare(b.registrationId));
      return { type: selected.type, workshopId: selected.workshopId, accommodationGroup: selected.accommodationGroup,
        expected, scanned, remainingCount: expected - scanned, remaining };
    },
  };
}
