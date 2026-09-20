import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError, configurationError } from '../errors.js';
import { COLLECTIONS, PAYMENT_STATUS, REGISTRATION_STATUS } from '../config/constants.js';
import { getAuthorizedRegistration } from './registration-access.js';

const PAYLOAD_PREFIX = 'vyora26:t:';

function asTimestamp(now) {
  return Timestamp.fromMillis(typeof now === 'number' ? now : now.getTime());
}

function signingSecret(getSigningSecret) {
  const secret = getSigningSecret();
  if (typeof secret !== 'string' || secret.length < 32) {
    throw configurationError('TICKET_SIGNING_SECRET must contain at least 32 characters.');
  }
  return secret;
}

export function ticketPayloadForRegistration(registrationDocId, secret) {
  const credential = createHmac('sha256', secret)
    .update(`vyora26:ticket:v1:${registrationDocId}`)
    .digest('base64url');
  return `${PAYLOAD_PREFIX}${credential}`;
}

export function ticketTokenHash(payload) {
  return createHash('sha256').update(payload).digest('hex');
}

export function isTicketPayload(value) {
  return typeof value === 'string' && /^vyora26:t:[A-Za-z0-9_-]{43}$/.test(value);
}

function ticketId(random = randomBytes) {
  return `TKT-${random(10).toString('hex').toUpperCase()}`;
}

function assertConfirmed(registration) {
  if (
    registration.registrationStatus !== REGISTRATION_STATUS.confirmed
    || registration.paymentStatus !== PAYMENT_STATUS.paid
  ) {
    throw new AppError('TICKET_NOT_AVAILABLE', 'A ticket is available only after confirmed payment.', 409);
  }
}

export function createTicketService({
  db,
  getSigningSecret,
  clock = () => Date.now(),
  random = randomBytes,
}) {
  function derived(registrationDocId) {
    const payload = ticketPayloadForRegistration(registrationDocId, signingSecret(getSigningSecret));
    return { payload, hash: ticketTokenHash(payload) };
  }

  async function issueForRegistrationRef(registrationRef) {
    const ticketRef = db.collection(COLLECTIONS.tickets).doc(registrationRef.id);
    const credential = derived(registrationRef.id);
    const candidateTicketId = ticketId(random);
    const result = await db.runTransaction(async (transaction) => {
      const [registrationSnapshot, existingTicketSnapshot] = await transaction.getAll(registrationRef, ticketRef);
      if (!registrationSnapshot.exists) {
        throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
      }
      const registration = registrationSnapshot.data();
      assertConfirmed(registration);
      const existing = existingTicketSnapshot.data();
      if (existing) {
        if (existing.registrationDocId !== registrationRef.id || existing.qrTokenHash !== credential.hash) {
          throw configurationError('The stored ticket does not match the configured ticket credential.');
        }
        if (registration.ticketIssued !== true || registration.ticketId !== existing.ticketId) {
          transaction.update(registrationRef, {
            ticketIssued: true,
            ticketId: existing.ticketId,
            updatedAt: asTimestamp(clock()),
          });
        }
        return { ticket: existing, registration, created: false };
      }

      const issuedAt = asTimestamp(clock());
      const ticket = {
        ticketId: candidateTicketId,
        registrationDocId: registrationRef.id,
        registrationId: registration.registrationId,
        qrTokenHash: credential.hash,
        active: true,
        issuedAt,
      };
      transaction.create(ticketRef, ticket);
      transaction.update(registrationRef, {
        ticketIssued: true,
        ticketId: candidateTicketId,
        updatedAt: issuedAt,
      });
      return { ticket, registration, created: true };
    });
    return { ...result, ticketPayload: credential.payload };
  }

  async function participantTicket(registrationId, recoveryTokenHash) {
    const { ref } = await getAuthorizedRegistration(db, registrationId, recoveryTokenHash);
    const result = await issueForRegistrationRef(ref);
    return {
      ticketId: result.ticket.ticketId,
      ticketPayload: result.ticketPayload,
      issuedAt: result.ticket.issuedAt.toDate().toISOString(),
      participant: {
        fullName: result.registration.fullName,
        registrationId: result.registration.registrationId,
        workshopId: result.registration.workshopId,
      },
    };
  }

  async function findByPayload(payload) {
    if (!isTicketPayload(payload)) {
      throw new AppError('INVALID_TICKET', 'The QR code is not a valid VYORA ticket.', 400);
    }
    const hash = ticketTokenHash(payload);
    const snapshot = await db.collection(COLLECTIONS.tickets)
      .where('qrTokenHash', '==', hash)
      .limit(2)
      .get();
    if (snapshot.size !== 1) {
      throw new AppError('INVALID_TICKET', 'The ticket could not be found.', 404);
    }
    const document = snapshot.docs[0];
    const stored = Buffer.from(document.data().qrTokenHash, 'hex');
    const supplied = Buffer.from(hash, 'hex');
    if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
      throw new AppError('INVALID_TICKET', 'The ticket could not be found.', 404);
    }
    return { ref: document.ref, data: document.data() };
  }

  return { issueForRegistrationRef, participantTicket, findByPayload };
}
