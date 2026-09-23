import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';
import { COLLECTIONS, HOSTELS, STAY_TYPES } from '../config/constants.js';

const ACCOMMODATION_FIELDS = ['isHosteller', 'hostel', 'needsStay', 'stayType'];

function assertAdmin(admin) {
  if (admin?.role !== 'ADMIN' || !admin.uid) throw new AppError('FORBIDDEN', 'Administrator access is required.', 403);
}

function assertKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new AppError('INVALID_TICKET_EDIT', 'The edit contains unsupported fields.', 400);
  }
}

export function validateAccommodation(value) {
  assertKeys(value, ACCOMMODATION_FIELDS);
  if (ACCOMMODATION_FIELDS.some((field) => !Object.hasOwn(value, field))
    || typeof value.isHosteller !== 'boolean' || typeof value.needsStay !== 'boolean'
    || (value.isHosteller && (!HOSTELS.includes(value.hostel) || value.needsStay || value.stayType !== null))
    || (!value.isHosteller && (value.hostel !== null
      || (value.needsStay ? !STAY_TYPES.includes(value.stayType) : value.stayType !== null)))) {
    throw new AppError('INVALID_ACCOMMODATION_SELECTION', 'The accommodation selection is not valid.', 400);
  }
  return value;
}

function validTicket(registration, ticket, registrationDocId) {
  return registration.registrationStatus === 'CONFIRMED' && registration.paymentStatus === 'PAID'
    && registration.ticketIssued === true && ticket?.active === true
    && ticket.registrationDocId === registrationDocId
    && registration.ticketId === ticket.ticketId && registration.registrationId === ticket.registrationId;
}

function publicDetail(registration, ticket) {
  return {
    registrationId: registration.registrationId, fullName: registration.fullName,
    year: registration.year, department: registration.department || null, class: registration.class || null,
    ticketId: ticket.ticketId, isHosteller: registration.isHosteller, hostel: registration.hostel,
    needsStay: registration.needsStay, stayType: registration.stayType,
    originalTotalFee: registration.totalFee, razorpayPaymentId: registration.razorpayPaymentId || null,
    manualPayments: (registration.manualPayments || []).map((payment) => ({
      amountPaise: payment.amountPaise, reason: payment.reason,
      collectedAt: payment.collectedAt?.toDate?.().toISOString() || null,
      recordedBy: payment.recordedBy,
    })),
    updatedAt: registration.updatedAt?.toDate?.().toISOString() || null,
  };
}

export function createTicketEditService({ db, clock = () => Date.now() }) {
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
      throw new AppError('TICKET_NOT_EDITABLE', 'A valid confirmed ticket is required.', 409);
    }
    return publicDetail(registration, ticket);
  }

  async function apply(registrationId, input, admin) {
    assertAdmin(admin);
    assertKeys(input, ['requestId', 'expectedUpdatedAt', 'accommodation', 'manualPayment']);
    if (typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.requestId)
      || typeof input.expectedUpdatedAt !== 'string') {
      throw new AppError('INVALID_TICKET_EDIT', 'The edit request is invalid.', 400);
    }
    if (!Object.hasOwn(input, 'accommodation') && !Object.hasOwn(input, 'manualPayment')) {
      throw new AppError('INVALID_TICKET_EDIT', 'Select an accommodation change or manual payment.', 400);
    }
    const accommodation = Object.hasOwn(input, 'accommodation') ? validateAccommodation(input.accommodation) : null;
    let manualPayment = null;
    if (Object.hasOwn(input, 'manualPayment')) {
      assertKeys(input.manualPayment, ['amountPaise', 'reason']);
      const { amountPaise, reason } = input.manualPayment;
      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0
        || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 200) {
        throw new AppError('INVALID_MANUAL_PAYMENT', 'Enter a positive INR amount and a reason.', 400);
      }
      manualPayment = { amountPaise, reason: reason.trim() };
    }
    const ref = await find(registrationId);
    const ticketRef = db.collection(COLLECTIONS.tickets).doc(ref.id);
    const auditRef = db.collection(COLLECTIONS.auditLogs).doc(`ticket_edit_${input.requestId}`);
    await db.runTransaction(async (transaction) => {
      const [auditSnapshot, registrationSnapshot, ticketSnapshot] = await transaction.getAll(auditRef, ref, ticketRef);
      if (auditSnapshot.exists) {
        if (auditSnapshot.data().registrationDocId !== ref.id || auditSnapshot.data().performedBy !== admin.uid) {
          throw new AppError('INVALID_TICKET_EDIT', 'This edit request was already used.', 409);
        }
        return;
      }
      const current = registrationSnapshot.data();
      if (!current || !validTicket(current, ticketSnapshot.data(), ref.id)) {
        throw new AppError('TICKET_NOT_EDITABLE', 'A valid confirmed ticket is required.', 409);
      }
      if (current.updatedAt?.toDate?.().toISOString() !== input.expectedUpdatedAt) {
        throw new AppError('TICKET_EDIT_STALE', 'The registration changed. Reload and review it again.', 409);
      }
      if (current.manualPayments != null && !Array.isArray(current.manualPayments)) {
        throw new AppError('INTERNAL_ERROR', 'Manual payment history is invalid.', 500);
      }
      const before = Object.fromEntries(ACCOMMODATION_FIELDS.map((field) => [field, current[field]]));
      const after = accommodation || before;
      const changed = ACCOMMODATION_FIELDS.some((field) => before[field] !== after[field]);
      if (!changed && !manualPayment) throw new AppError('INVALID_TICKET_EDIT', 'No change was submitted.', 400);
      const now = Timestamp.fromMillis(clock());
      const update = { updatedAt: now };
      if (changed) Object.assign(update, after);
      if (manualPayment) update.manualPayments = [
        ...(current.manualPayments || []),
        { ...manualPayment, collectedAt: now, recordedBy: admin.uid },
      ];
      transaction.update(ref, update);
      transaction.create(auditRef, {
        action: 'TICKET_EDIT', registrationDocId: ref.id, registrationId: current.registrationId,
        performedBy: admin.uid, createdAt: now,
        metadata: { previous: before, next: after, manualPayment },
      });
    });
    return detail(registrationId, admin);
  }

  return { detail, apply };
}
