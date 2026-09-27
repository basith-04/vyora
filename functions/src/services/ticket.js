import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError, configurationError } from '../errors.js';
import { COLLECTIONS, PAYMENT_STATUS, REGISTRATION_STATUS } from '../config/constants.js';
import { getAuthorizedRegistration } from './registration-access.js';

const PAYLOAD_PREFIX = 'vyora26:t:';
const VIEW_TOKEN_PREFIX = 'vyora26:v:';

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

export function ticketPayloadForRegistration(registrationDocId, secret, version = 0) {
  const credential = createHmac('sha256', secret)
    .update(`vyora26:ticket:v1:${registrationDocId}${version ? `:transfer:${version}` : ''}`)
    .digest('base64url');
  return `${PAYLOAD_PREFIX}${credential}`;
}

export function ticketViewTokenForRegistration(registrationDocId, secret, version = 0) {
  const credential = createHmac('sha256', secret)
    .update(`vyora26:ticket-view:v1:${registrationDocId}${version ? `:transfer:${version}` : ''}`)
    .digest('base64url');
  return `${VIEW_TOKEN_PREFIX}${credential}`;
}

export function ticketTokenHash(payload) {
  return createHash('sha256').update(payload).digest('hex');
}

export function isTicketPayload(value) {
  return typeof value === 'string' && /^vyora26:t:[A-Za-z0-9_-]{43}$/.test(value);
}

export function isTicketViewToken(value) {
  return typeof value === 'string' && /^vyora26:v:[A-Za-z0-9_-]{43}$/.test(value);
}

function ticketId(random = randomBytes) {
  return `TKT-${random(10).toString('hex').toUpperCase()}`;
}

export function isPaidConfirmed(registration) {
  return registration?.registrationStatus === REGISTRATION_STATUS.confirmed
    && registration?.paymentStatus === PAYMENT_STATUS.paid;
}

function assertConfirmed(registration) {
  if (
    !isPaidConfirmed(registration)
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
  function derived(registrationDocId, version = 0) {
    const payload = ticketPayloadForRegistration(registrationDocId, signingSecret(getSigningSecret), version);
    const viewToken = ticketViewTokenForRegistration(registrationDocId, signingSecret(getSigningSecret), version);
    return {
      payload,
      hash: ticketTokenHash(payload),
      viewToken,
      viewTokenHash: ticketTokenHash(viewToken),
    };
  }

  function participantResponse(result) {
    return {
      ticketId: result.ticket.ticketId,
      ticketPayload: result.ticketPayload,
      issuedAt: result.ticket.issuedAt.toDate().toISOString(),
      participant: {
        fullName: result.registration.fullName,
        registrationId: result.registration.registrationId,
        ieeeMember: result.registration.ieeeMember === true,
        workshopId: result.registration.workshopId,
      },
    };
  }

  async function issueForRegistrationRef(registrationRef) {
    const ticketRef = db.collection(COLLECTIONS.tickets).doc(registrationRef.id);
    const candidateTicketId = ticketId(random);
    const result = await db.runTransaction(async (transaction) => {
      const [registrationSnapshot, existingTicketSnapshot] = await transaction.getAll(registrationRef, ticketRef);
      if (!registrationSnapshot.exists) {
        throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
      }
      const registration = registrationSnapshot.data();
      assertConfirmed(registration);
      const existing = existingTicketSnapshot.data();
      const credential = derived(registrationRef.id, existing?.credentialVersion || 0);
      if (existing) {
        if (existing.registrationDocId !== registrationRef.id || existing.qrTokenHash !== credential.hash) {
          throw configurationError('The stored ticket does not match the configured ticket credential.');
        }
        if (existing.viewTokenHash && existing.viewTokenHash !== credential.viewTokenHash) {
          throw configurationError('The stored ticket view credential does not match the configured ticket credential.');
        }
        if (!existing.viewTokenHash) {
          transaction.update(ticketRef, { viewTokenHash: credential.viewTokenHash });
          existing.viewTokenHash = credential.viewTokenHash;
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
        viewTokenHash: credential.viewTokenHash,
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
    const credential = derived(registrationRef.id, result.ticket.credentialVersion || 0);
    return { ...result, ticketPayload: credential.payload, ticketViewToken: credential.viewToken };
  }

  async function participantTicket(registrationId, recoveryTokenHash) {
    const { ref } = await getAuthorizedRegistration(db, registrationId, recoveryTokenHash);
    const result = await issueForRegistrationRef(ref);
    return participantResponse(result);
  }

  async function existingForRegistrationRef(registrationRef) {
    const [registrationSnapshot, ticketSnapshot] = await Promise.all([
      registrationRef.get(),
      db.collection(COLLECTIONS.tickets).doc(registrationRef.id).get(),
    ]);
    if (!registrationSnapshot.exists || !ticketSnapshot.exists) {
      throw new AppError('TICKET_NOT_AVAILABLE', 'The confirmed ticket has not been issued yet.', 409);
    }
    const registration = registrationSnapshot.data();
    const ticket = ticketSnapshot.data();
    assertConfirmed(registration);
    const credential = derived(registrationRef.id, ticket.credentialVersion || 0);
    if (
      ticket.active !== true
      || ticket.registrationDocId !== registrationRef.id
      || ticket.registrationId !== registration.registrationId
      || ticket.qrTokenHash !== credential.hash
      || ticket.viewTokenHash !== credential.viewTokenHash
      || registration.ticketIssued !== true
      || registration.ticketId !== ticket.ticketId
    ) {
      throw new AppError('TICKET_NOT_AVAILABLE', 'The confirmed ticket is not available.', 409);
    }
    return {
      ticket,
      registration,
      created: false,
      ticketPayload: credential.payload,
      ticketViewToken: credential.viewToken,
    };
  }

  async function viewByToken(viewToken) {
    if (!isTicketViewToken(viewToken)) {
      throw new AppError('TICKET_VIEW_INVALID', 'The ticket link is invalid.', 404);
    }
    const viewTokenHash = ticketTokenHash(viewToken);
    const snapshot = await db.collection(COLLECTIONS.tickets)
      .where('viewTokenHash', '==', viewTokenHash)
      .limit(2)
      .get();
    if (snapshot.size !== 1) {
      throw new AppError('TICKET_VIEW_INVALID', 'The ticket link is invalid.', 404);
    }
    const ticketDocument = snapshot.docs[0];
    const ticket = ticketDocument.data();
    const stored = Buffer.from(ticket.viewTokenHash, 'hex');
    const supplied = Buffer.from(viewTokenHash, 'hex');
    if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
      throw new AppError('TICKET_VIEW_INVALID', 'The ticket link is invalid.', 404);
    }
    const registrationSnapshot = await db.collection(COLLECTIONS.registrations)
      .doc(ticket.registrationDocId)
      .get();
    if (!registrationSnapshot.exists) {
      throw new AppError('TICKET_VIEW_INVALID', 'The ticket link is invalid.', 404);
    }
    const registration = registrationSnapshot.data();
    assertConfirmed(registration);
    const credential = derived(ticket.registrationDocId, ticket.credentialVersion || 0);
    if (
      ticket.active !== true
      || ticket.viewTokenHash !== credential.viewTokenHash
      || ticket.qrTokenHash !== credential.hash
      || registration.ticketIssued !== true
      || registration.ticketId !== ticket.ticketId
      || ticket.registrationId !== registration.registrationId
    ) {
      throw new AppError('TICKET_VIEW_INVALID', 'The ticket link is invalid.', 404);
    }
    return participantResponse({ ticket, registration, ticketPayload: credential.payload });
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

  return {
    rotatedCredential(registrationDocId, ticket) {
      const currentVersion = ticket.credentialVersion || 0;
      const current = derived(registrationDocId, currentVersion);
      if (!Number.isSafeInteger(currentVersion) || currentVersion < 0
        || ticket.qrTokenHash !== current.hash || ticket.viewTokenHash !== current.viewTokenHash) {
        throw configurationError('The stored ticket credential cannot be rotated safely.');
      }
      const credentialVersion = currentVersion + 1;
      return { credentialVersion, ...derived(registrationDocId, credentialVersion) };
    },
    issueForRegistrationRef,
    existingForRegistrationRef,
    participantTicket,
    viewByToken,
    findByPayload,
  };
}
