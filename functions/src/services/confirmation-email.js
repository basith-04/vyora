import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';
import { COLLECTIONS, PAYMENT_STATUS, REGISTRATION_STATUS } from '../config/constants.js';
import { findRegistrationByPublicId } from './registration-access.js';
import { confirmationEmailContent } from './email-template.js';

const MAX_ATTEMPTS = 3;
const LEASE_MILLISECONDS = 120_000;

function timestamp(clock) {
  const value = clock();
  return Timestamp.fromMillis(typeof value === 'number' ? value : value.getTime());
}

function safeErrorCode(error) {
  if (typeof error?.code === 'string' && /^EMAIL_[A-Z_]+$/.test(error.code)) return error.code;
  if (error?.message === 'PUBLIC_BASE_URL_INVALID') return 'EMAIL_CONFIGURATION_ERROR';
  return 'EMAIL_SEND_FAILED';
}

function currentState(registration) {
  return registration.confirmationEmail || {
    status: 'PENDING', attempts: 0, sentAt: null, lastAttemptAt: null,
    lastErrorCode: null, providerMessageId: null, leaseExpiresAt: null,
  };
}

function assertEmailTicket(registration, ticket, issued, documentId) {
  if (!registration || !ticket || registration.registrationStatus !== REGISTRATION_STATUS.confirmed
    || registration.paymentStatus !== PAYMENT_STATUS.paid || registration.ticketIssued !== true
    || registration.ticketId !== ticket.ticketId || ticket.active !== true
    || ticket.registrationDocId !== documentId || ticket.registrationId !== registration.registrationId
    || ticket.viewTokenHash !== issued.ticket.viewTokenHash || ticket.qrTokenHash !== issued.ticket.qrTokenHash) {
    throw new AppError('TICKET_NOT_AVAILABLE', 'A confirmed active ticket is required before email delivery.', 409);
  }
}

export function createConfirmationEmailService({
  db,
  ticketService,
  provider,
  getPublicBaseUrl,
  clock = () => Date.now(),
  logger = console,
}) {
  async function deliver(registration, issued, idempotencyKey) {
    const content = confirmationEmailContent({ registration,
      ticketViewToken: issued.ticketViewToken, baseUrl: getPublicBaseUrl() });
    return provider.send({ to: registration.email, subject: content.subject,
      html: content.html, text: content.text, idempotencyKey });
  }

  async function claim(registrationRef, issued, allowRetry) {
    const ticketRef = db.collection(COLLECTIONS.tickets).doc(registrationRef.id);
    return db.runTransaction(async (transaction) => {
      const [registrationSnapshot, ticketSnapshot] = await transaction.getAll(registrationRef, ticketRef);
      if (!registrationSnapshot.exists || !ticketSnapshot.exists) {
        throw new AppError('TICKET_NOT_AVAILABLE', 'A confirmed ticket is required before email delivery.', 409);
      }
      const registration = registrationSnapshot.data();
      const ticket = ticketSnapshot.data();
      assertEmailTicket(registration, ticket, issued, registrationRef.id);
      const state = currentState(registration);
      if (state.status === 'SENT') return { outcome: 'SENT', state, registration };
      const clockValue = clock();
      const nowMillis = typeof clockValue === 'number' ? clockValue : clockValue.getTime();
      const leaseExpired = state.leaseExpiresAt?.toMillis?.() <= nowMillis;
      if (state.status === 'SENDING' && !(allowRetry && leaseExpired)) {
        return { outcome: 'IN_PROGRESS', state, registration };
      }
      if (state.status === 'FAILED' && !allowRetry) return { outcome: 'FAILED', state, registration };
      if ((state.attempts || 0) >= MAX_ATTEMPTS) return { outcome: 'RETRY_LIMIT_REACHED', state, registration };

      const now = Timestamp.fromMillis(nowMillis);
      const next = {
        status: 'SENDING',
        ...(state.deliveryVersion ? { deliveryVersion: state.deliveryVersion } : {}),
        attempts: (state.attempts || 0) + 1,
        sentAt: state.sentAt || null,
        lastAttemptAt: now,
        lastErrorCode: null,
        providerMessageId: state.providerMessageId || null,
        leaseExpiresAt: Timestamp.fromMillis(now.toMillis() + LEASE_MILLISECONDS),
      };
      transaction.update(registrationRef, { confirmationEmail: next, updatedAt: now });
      return { outcome: 'CLAIMED', state: next, registration };
    });
  }

  async function finish(registrationRef, attempt, version, update) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(registrationRef);
      if (!snapshot.exists) return;
      const registration = snapshot.data();
      const state = currentState(registration);
      if (state.status !== 'SENDING' || state.attempts !== attempt
        || (state.deliveryVersion || 0) !== version) return;
      const now = timestamp(clock);
      transaction.update(registrationRef, {
        confirmationEmail: { ...state, ...update, leaseExpiresAt: null },
        updatedAt: now,
      });
    });
  }

  async function sendForRegistrationRef(registrationRef, issued, { allowRetry = false } = {}) {
    const claimed = await claim(registrationRef, issued, allowRetry);
    if (claimed.outcome !== 'CLAIMED') return claimed;
    const attempt = claimed.state.attempts;
    const version = issued.ticket.credentialVersion || 0;
    try {
      const delivered = await deliver(claimed.registration, issued,
        `vyora26-confirmation/${registrationRef.id}${version ? `/transfer/${version}` : ''}`);
      const sentAt = timestamp(clock);
      await finish(registrationRef, attempt, version, {
        status: 'SENT', sentAt, lastErrorCode: null,
        providerMessageId: delivered.providerMessageId,
      });
      return { outcome: 'SENT', sentAt: sentAt.toDate().toISOString(), attempts: attempt };
    } catch (error) {
      const code = safeErrorCode(error);
      await finish(registrationRef, attempt, version, { status: 'FAILED', lastErrorCode: code });
      logger.error('Confirmation email delivery failed.', {
        registrationId: claimed.registration.registrationId,
        operation: 'send_confirmation_email',
        result: 'failed',
        code,
      });
      return { outcome: 'FAILED', attempts: attempt, errorCode: code };
    }
  }

  async function retryByRegistrationId(registrationId) {
    const snapshot = await db.collection(COLLECTIONS.registrations)
      .where('registrationId', '==', registrationId)
      .limit(2)
      .get();
    if (snapshot.size !== 1) {
      throw new AppError('REGISTRATION_NOT_FOUND', 'The registration could not be found.', 404);
    }
    const registrationRef = snapshot.docs[0].ref;
    const issued = await ticketService.existingForRegistrationRef(registrationRef);
    return sendForRegistrationRef(registrationRef, issued, { allowRetry: true });
  }

  function assertAdmin(admin) {
    if (admin?.role !== 'ADMIN' || !admin.uid) throw new AppError('FORBIDDEN', 'Administrator access is required.', 403);
  }

  async function resendDetail(registrationId, admin) {
    assertAdmin(admin);
    const { ref } = await findRegistrationByPublicId(db, registrationId);
    const { registration, ticket } = await ticketService.existingForRegistrationRef(ref);
    return { registrationId: registration.registrationId, fullName: registration.fullName,
      email: registration.email, ticketId: ticket.ticketId };
  }

  async function resendByRegistrationId(registrationId, input, admin) {
    assertAdmin(admin);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== 1 || typeof input.requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) {
      throw new AppError('INVALID_EMAIL_RESEND', 'The resend request is invalid.', 400);
    }
    const { ref } = await findRegistrationByPublicId(db, registrationId);
    // Read-only lookup validates current credentials. Never issue or rotate a ticket.
    const issued = await ticketService.existingForRegistrationRef(ref);
    const ticketRef = db.collection(COLLECTIONS.tickets).doc(ref.id);
    const requestId = input.requestId.toLowerCase();
    const auditRef = db.collection(COLLECTIONS.auditLogs).doc(`ticket_email_resend_${requestId}`);
    const claimRef = db.collection(COLLECTIONS.auditLogs).doc(`ticket_email_resend_claim_${ref.id}`);
    const claimed = await db.runTransaction(async (tx) => {
      const [registrationSnapshot, ticketSnapshot, auditSnapshot, claimSnapshot] = await tx.getAll(ref, ticketRef, auditRef, claimRef);
      const registration = registrationSnapshot.data();
      const ticket = ticketSnapshot.data();
      // Recheck the ticket obtained by the canonical read helper inside the claim.
      assertEmailTicket(registration, ticket, issued, ref.id);
      if (registration.email !== issued.registration.email) {
        throw new AppError('TICKET_NOT_AVAILABLE', 'The participant changed. Review the current ticket again.', 409);
      }
      const previous = auditSnapshot.data();
      if (previous && (previous.registrationDocId !== ref.id || previous.performedBy !== admin.uid)) {
        throw new AppError('INVALID_EMAIL_RESEND', 'The resend request was already used.', 409);
      }
      if (previous?.status === 'SENT') return { outcome: 'SENT' };
      const now = timestamp(clock);
      const lease = claimSnapshot.data();
      if (lease?.leaseExpiresAt?.toMillis() > now.toMillis()) return { outcome: 'IN_PROGRESS' };
      // An expired/failed attempt may be retried only for the same current ticket.
      if (previous && (previous.ticketId !== ticket.ticketId || previous.credentialVersion !== (ticket.credentialVersion || 0))) {
        throw new AppError('INVALID_EMAIL_RESEND', 'The current ticket changed. Review it again.', 409);
      }
      if ((previous?.attempts || 0) >= MAX_ATTEMPTS) return { outcome: 'RETRY_LIMIT_REACHED' };
      const attempt = (previous?.attempts || 0) + 1;
      tx.set(claimRef, { action: 'TICKET_EMAIL_RESEND_CLAIM', registrationDocId: ref.id,
        registrationId, performedBy: admin.uid, requestId, createdAt: now,
        leaseExpiresAt: Timestamp.fromMillis(now.toMillis() + LEASE_MILLISECONDS) });
      tx.set(auditRef, { action: 'TICKET_EMAIL_RESEND', registrationDocId: ref.id,
        registrationId, ticketId: ticket.ticketId, credentialVersion: ticket.credentialVersion || 0, performedBy: admin.uid,
        createdAt: previous?.createdAt || now, lastAttemptAt: now,
        attempts: attempt, status: 'SENDING', lastErrorCode: null });
      return { outcome: 'CLAIMED', registration, attempt };
    });
    if (claimed.outcome !== 'CLAIMED') return { outcome: claimed.outcome };
    let status = 'SENT';
    let errorCode = null;
    try {
      await deliver(claimed.registration, issued, `vyora26-ticket-resend/${requestId}`);
    } catch (error) {
      status = 'FAILED'; errorCode = safeErrorCode(error);
      logger.error('Ticket email resend failed.', { operation: 'ticket_email_resend', code: errorCode });
    }
    await db.runTransaction(async (tx) => {
      const [auditSnapshot, claimSnapshot] = await tx.getAll(auditRef, claimRef);
      if (auditSnapshot.data()?.attempts !== claimed.attempt || auditSnapshot.data()?.status !== 'SENDING') return;
      tx.update(auditRef, { status, lastErrorCode: errorCode, completedAt: timestamp(clock) });
      if (claimSnapshot.data()?.requestId === requestId) tx.update(claimRef, { leaseExpiresAt: null });
    });
    return { outcome: status };
  }

  return { sendForRegistrationRef, retryByRegistrationId, resendDetail, resendByRegistrationId };

}
