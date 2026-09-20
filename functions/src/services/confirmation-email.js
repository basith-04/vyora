import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../errors.js';
import { COLLECTIONS, PAYMENT_STATUS, REGISTRATION_STATUS } from '../config/constants.js';
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

export function createConfirmationEmailService({
  db,
  ticketService,
  provider,
  getPublicBaseUrl,
  clock = () => Date.now(),
  logger = console,
}) {
  async function claim(registrationRef, issued, allowRetry) {
    const ticketRef = db.collection(COLLECTIONS.tickets).doc(registrationRef.id);
    return db.runTransaction(async (transaction) => {
      const [registrationSnapshot, ticketSnapshot] = await transaction.getAll(registrationRef, ticketRef);
      if (!registrationSnapshot.exists || !ticketSnapshot.exists) {
        throw new AppError('TICKET_NOT_AVAILABLE', 'A confirmed ticket is required before email delivery.', 409);
      }
      const registration = registrationSnapshot.data();
      const ticket = ticketSnapshot.data();
      if (
        registration.registrationStatus !== REGISTRATION_STATUS.confirmed
        || registration.paymentStatus !== PAYMENT_STATUS.paid
        || registration.ticketIssued !== true
        || registration.ticketId !== ticket.ticketId
        || ticket.active !== true
        || ticket.viewTokenHash !== issued.ticket.viewTokenHash
      ) {
        throw new AppError('TICKET_NOT_AVAILABLE', 'A confirmed active ticket is required before email delivery.', 409);
      }
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

  async function finish(registrationRef, attempt, update) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(registrationRef);
      if (!snapshot.exists) return;
      const registration = snapshot.data();
      const state = currentState(registration);
      if (state.status !== 'SENDING' || state.attempts !== attempt) return;
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
    try {
      const content = confirmationEmailContent({
        registration: claimed.registration,
        ticketViewToken: issued.ticketViewToken,
        baseUrl: getPublicBaseUrl(),
      });
      const delivered = await provider.send({
        to: claimed.registration.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        idempotencyKey: `vyora26-confirmation/${registrationRef.id}`,
      });
      const sentAt = timestamp(clock);
      await finish(registrationRef, attempt, {
        status: 'SENT', sentAt, lastErrorCode: null,
        providerMessageId: delivered.providerMessageId,
      });
      return { outcome: 'SENT', sentAt: sentAt.toDate().toISOString(), attempts: attempt };
    } catch (error) {
      const code = safeErrorCode(error);
      await finish(registrationRef, attempt, { status: 'FAILED', lastErrorCode: code });
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

  return { sendForRegistrationRef, retryByRegistrationId };
}
