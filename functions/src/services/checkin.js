import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';
import {
  CHECKIN_TYPE, CHECKOUT_GROUP, COLLECTIONS, HOSTELS, WORKSHOP_IDS,
} from '../config/constants.js';
import { isPaidConfirmed } from './ticket.js';
import { matchesRegistrationFilters } from '../../shared/report-filters.js';

const CHECKOUT_TYPES = new Set([CHECKIN_TYPE.day1Checkout, CHECKIN_TYPE.day2Checkout]);
const TYPES = new Set(Object.values(CHECKIN_TYPE));
const DAY2_PREREQUISITES = {
  [CHECKIN_TYPE.fieldTripDeparture]: [CHECKIN_TYPE.workshop],
  [CHECKIN_TYPE.fieldTripReturn]: [CHECKIN_TYPE.fieldTripDeparture],
  [CHECKIN_TYPE.day2Checkout]: [CHECKIN_TYPE.workshop, CHECKIN_TYPE.fieldTripDeparture, CHECKIN_TYPE.fieldTripReturn],
};
const PREREQUISITE_ERRORS = {
  [CHECKIN_TYPE.fieldTripDeparture]: ['WORKSHOP_CHECKIN_REQUIRED', 'Workshop check-in is required before field-trip departure.'],
  [CHECKIN_TYPE.fieldTripReturn]: ['FIELD_TRIP_DEPARTURE_REQUIRED', 'Field-trip departure is required before return check-in.'],
  [CHECKIN_TYPE.day2Checkout]: ['DAY2_ATTENDANCE_REQUIRED', 'Workshop or field-trip attendance is required before Day 2 checkout.'],
};

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

// Read canonical identities only; no stored absence state or mutable attendance counters.
function attendanceSets(documents) {
  const sets = new Map();
  for (const doc of documents) {
    if (!doc.exists) continue;
    const data = doc.data();
    if (typeof data.registrationDocId !== 'string' || !TYPES.has(data.type)
      || (data.type === CHECKIN_TYPE.workshop ? !WORKSHOP_IDS.includes(data.workshopId) : data.workshopId != null)
      || doc.id !== checkinDocumentId(data.type, data.workshopId, data.registrationDocId)) continue;
    if (!sets.has(data.type)) sets.set(data.type, new Set());
    sets.get(data.type).add(data.registrationDocId);
  }
  return sets;
}

function hasPrerequisite(type, registrationDocId, sets) {
  const required = DAY2_PREREQUISITES[type];
  return !required || required.some((prior) => sets.get(prior)?.has(registrationDocId));
}

function iso(value) {
  return value?.toDate().toISOString();
}

function participantResult(registration, checkin, outcome, day1Absent) {
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
      ...(checkin.type === CHECKIN_TYPE.workshop ? { day1Absent } : {}),
    },
  };
}

function validateSelection(input, scan = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('INVALID_CHECKIN_REQUEST', 'Check-in data is required.', 400);
  }
  const allowed = new Set(scan ? ['ticketToken', 'registrationDocId', 'type', 'workshopId', 'accommodationGroup'] : ['type', 'workshopId', 'accommodationGroup']);
  if (Object.keys(input).some((field) => !allowed.has(field))) {
    throw new AppError('INVALID_CHECKIN_REQUEST', 'The check-in request contains unsupported fields.', 400);
  }
  if (scan && ((Object.hasOwn(input, 'ticketToken') && Object.hasOwn(input, 'registrationDocId'))
    || (Object.hasOwn(input, 'registrationDocId') && (typeof input.registrationDocId !== 'string'
      || !input.registrationDocId.trim() || input.registrationDocId.length > 1500 || input.registrationDocId.includes('/'))))) {
    throw new AppError('INVALID_CHECKIN_REQUEST', 'Supply either a QR payload or a canonical registration reference.', 400);
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
  return { ticketToken: input.ticketToken, registrationDocId: input.registrationDocId, type: input.type, workshopId: input.workshopId ?? null,
    accommodationGroup: input.accommodationGroup ?? null };
}

export function createCheckinService({ db, ticketService, clock = () => Date.now() }) {
  return {
    async checkIn(input, admin, timings = {}) {
      assertStaff(admin);
      const checked = validateSelection(input, true);
      let ticket;
      const credentialStarted = performance.now();
      try {
        if (checked.registrationDocId != null) {
          // Staff selection resolves the same canonical ticket; the transaction below
          // rechecks ticket/registration integrity and all attendance rules.
          const ref = db.collection(COLLECTIONS.tickets).doc(checked.registrationDocId);
          const snapshot = await ref.get();
          if (!snapshot.exists) throw new AppError('INVALID_TICKET', 'The ticket could not be found.', 404);
          ticket = { ref, data: snapshot.data() };
          if (ticket.data.registrationDocId !== checked.registrationDocId) {
            throw new AppError('INVALID_TICKET', 'The ticket could not be found.', 404);
          }
        } else ticket = await ticketService.findByPayload(checked.ticketToken);
      }
      finally { timings.credentialMs = performance.now() - credentialStarted; }
      const registrationRef = db.collection(COLLECTIONS.registrations).doc(ticket.data.registrationDocId);
      const checkinRef = db.collection(COLLECTIONS.checkins).doc(
        checkinDocumentId(checked.type, checked.workshopId, ticket.data.registrationDocId),
      );
      const evidenceTypes = checked.type === CHECKIN_TYPE.workshop ? [CHECKIN_TYPE.event] : DAY2_PREREQUISITES[checked.type] || [];
      const evidenceRefs = evidenceTypes.flatMap((type) =>
        (type === CHECKIN_TYPE.workshop ? WORKSHOP_IDS : [null]).map((workshopId) =>
          db.collection(COLLECTIONS.checkins).doc(checkinDocumentId(type, workshopId, registrationRef.id))));

      const transactionStarted = performance.now();
      timings.transactionAttempts = 0;
      let result;
      try {
        result = await db.runTransaction(async (transaction) => {
          timings.transactionAttempts += 1;
          const [ticketSnapshot, registrationSnapshot, existingCheckinSnapshot, ...evidence] = await transaction.getAll(
            ticket.ref, registrationRef, checkinRef, ...evidenceRefs,
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
          const sets = attendanceSets(evidence);
          const day1Absent = checked.type === CHECKIN_TYPE.workshop && !sets.get(CHECKIN_TYPE.event)?.has(registrationRef.id);
          if (existingCheckinSnapshot.exists) {
            return { registration, checkin: existingCheckinSnapshot.data(), outcome: 'ALREADY_CHECKED_IN', day1Absent };
          }
          if (!hasPrerequisite(checked.type, registrationRef.id, sets)) {
            const [code, message] = PREREQUISITE_ERRORS[checked.type];
            throw new AppError(code, message, 409);
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
          return { registration, checkin, outcome: 'CHECKED_IN', day1Absent };
        });
      } finally { timings.transactionMs = performance.now() - transactionStarted; }
      return participantResult(result.registration, result.checkin, result.outcome, result.day1Absent);
    },
    async searchParticipants(input, admin) {
      assertStaff(admin);
      if (!input || Object.keys(input).some((key) => key !== 'search')
        || typeof input.search !== 'string' || input.search.length > 120) {
        throw new AppError('INVALID_CHECKIN_REQUEST', 'Supply a participant name of up to 120 characters.', 400);
      }
      const search = input.search.trim().replace(/\s+/g, ' ');
      if (search.length < 2) return { participants: [] };
      // Small venue roster: reuse existing substring matching without a search index.
      // Select only identification/eligibility fields, never health or credentials.
      const [registrations, tickets] = await Promise.all([
        db.collection(COLLECTIONS.registrations).select('fullName', 'registrationId', 'workshopId',
          'isHosteller', 'hostel', 'needsStay', 'registrationStatus', 'paymentStatus', 'ticketIssued', 'ticketId').get(),
        db.collection(COLLECTIONS.tickets).select('registrationDocId', 'registrationId', 'ticketId', 'active').get(),
      ]);
      const ticketMap = new Map(tickets.docs.map((doc) => [doc.id, doc.data()]));
      const participants = registrations.docs.flatMap((doc) => {
        const registration = doc.data();
        const ticket = ticketMap.get(doc.id);
        if (!isPaidConfirmed(registration) || registration.ticketIssued !== true || !ticket
          || ticket.active !== true || ticket.registrationDocId !== doc.id
          || ticket.registrationId !== registration.registrationId || ticket.ticketId !== registration.ticketId
          || !matchesRegistrationFilters({ fullName: String(registration.fullName || '').replace(/\s+/g, ' ') }, search)) return [];
        return [{ registrationDocId: doc.id, fullName: registration.fullName,
          registrationId: registration.registrationId, workshopId: registration.workshopId,
          accommodationGroup: accommodationGroup(registration) }];
      });
      participants.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.registrationId.localeCompare(b.registrationId));
      return { participants };
    },
    async summary(input, admin) {
      assertStaff(admin);
      const selected = validateSelection(input);
      const evidenceTypes = selected.type === CHECKIN_TYPE.workshop ? [CHECKIN_TYPE.event] : DAY2_PREREQUISITES[selected.type] || [];
      const [registrationsSnapshot, checkinsSnapshot, ...evidence] = await Promise.all([
        db.collection(COLLECTIONS.registrations).get(),
        db.collection(COLLECTIONS.checkins).where('type', '==', selected.type).get(),
        ...evidenceTypes.map((type) => db.collection(COLLECTIONS.checkins).where('type', '==', type).get()),
      ]);
      const sets = attendanceSets(evidence.flatMap((snapshot) => snapshot.docs));
      const attended = DAY2_PREREQUISITES[selected.type] ? attendanceSets(checkinsSnapshot.docs).get(selected.type) || new Set() : new Set(checkinsSnapshot.docs
        .filter((doc) => selected.type !== CHECKIN_TYPE.workshop || doc.data().workshopId === selected.workshopId)
        .map((doc) => doc.data().registrationDocId));
      const checkinTimes = new Map(checkinsSnapshot.docs
        .filter((doc) => selected.type !== CHECKIN_TYPE.workshop || doc.data().workshopId === selected.workshopId)
        .map((doc) => [doc.data().registrationDocId, doc.data().checkedInAt]));
      let expected = 0;
      let scanned = 0;
      const remaining = [];
      const scannedParticipants = [];
      for (const doc of registrationsSnapshot.docs) {
        const registration = doc.data();
        if (!isPaidConfirmed(registration)) continue;
        if (!hasPrerequisite(selected.type, doc.id, sets)) continue;
        if (selected.type === CHECKIN_TYPE.workshop && registration.workshopId !== selected.workshopId) continue;
        if (CHECKOUT_TYPES.has(selected.type) && selected.accommodationGroup !== CHECKOUT_GROUP.all
          && accommodationGroup(registration) !== selected.accommodationGroup) continue;
        expected += 1;
        const participant = { fullName: registration.fullName, registrationId: registration.registrationId, phone: registration.phone ?? null,
          accommodationGroup: accommodationGroup(registration),
          ...(accommodationGroup(registration) === CHECKOUT_GROUP.stay ? { stayType: registration.stayType ?? null } : {}),
          ...(selected.type === CHECKIN_TYPE.workshop ? { workshopId: registration.workshopId, day1Absent: !sets.get(CHECKIN_TYPE.event)?.has(doc.id) } : {}) };
        if (attended.has(doc.id)) { scanned += 1; scannedParticipants.push({ ...participant, checkedInAt: iso(checkinTimes.get(doc.id)) ?? null }); continue; }
        remaining.push(participant);
      }
      remaining.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.registrationId.localeCompare(b.registrationId));
      return { type: selected.type, workshopId: selected.workshopId, accommodationGroup: selected.accommodationGroup,
        expected, scanned, remainingCount: expected - scanned, remaining, scannedParticipants };
    },
  };
}
