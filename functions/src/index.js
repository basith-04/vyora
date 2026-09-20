import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { db, auth } from './firebase.js';
import { createApp } from './app.js';
import { createRegistrationService } from './services/registration.js';
import { createExpirationService } from './services/expiration.js';
import { createRazorpayGateway } from './services/razorpay.js';
import { createCheckoutService } from './services/checkout.js';
import { createPaymentService } from './services/payment.js';
import { createWebhookService } from './services/webhook.js';
import { createAdminAuthorization } from './middleware/admin-auth.js';
import { createAdminReportingService } from './services/admin-reporting.js';
import { createAdminRouter } from './routes/admin.js';
import { createTicketService } from './services/ticket.js';
import { createCheckinService } from './services/checkin.js';
import { createResendEmailProvider } from './services/email-provider.js';
import { createConfirmationEmailService } from './services/confirmation-email.js';
import { createManualReconciliationService } from './services/manual-reconciliation.js';

const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');
const razorpayWebhookSecret = defineSecret('RAZORPAY_WEBHOOK_SECRET');
const ticketSigningSecret = defineSecret('TICKET_SIGNING_SECRET');
const emailApiKey = defineSecret('EMAIL_API_KEY');
const emailFrom = defineString('EMAIL_FROM');
const publicBaseUrl = defineString('PUBLIC_BASE_URL');

const createRegistration = createRegistrationService({ db });
const expirationService = createExpirationService({ db });
const razorpay = createRazorpayGateway({
  getKeyId: () => razorpayKeyId.value(),
  getKeySecret: () => razorpayKeySecret.value(),
});
const ticketService = createTicketService({
  db,
  getSigningSecret: () => ticketSigningSecret.value(),
});
const confirmationEmailService = createConfirmationEmailService({
  db,
  ticketService,
  provider: createResendEmailProvider({
    getApiKey: () => emailApiKey.value(),
    getFrom: () => emailFrom.value(),
  }),
  getPublicBaseUrl: () => publicBaseUrl.value(),
  logger,
});
const paymentService = createPaymentService({
  db,
  razorpay,
  getKeySecret: () => razorpayKeySecret.value(),
  ticketService,
  confirmationEmailService,
  logger,
});
const checkoutService = createCheckoutService({
  db, createRegistration, expirationService, razorpay, paymentService, logger,
});
const webhookService = createWebhookService({
  paymentService,
  getWebhookSecret: () => razorpayWebhookSecret.value(),
  logger,
});
const manualReconciliationService = createManualReconciliationService({
  db,
  razorpay,
  ticketService,
  confirmationEmailService,
  logger,
});
const adminRouter = createAdminRouter({
  authorizeAdmin: createAdminAuthorization({ auth, db }),
  reportingService: createAdminReportingService({ db }),
  checkinService: createCheckinService({ db, ticketService }),
  confirmationEmailService,
  manualReconciliationService,
});

export const api = onRequest(
  {
    region: 'asia-south1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [
      razorpayKeyId,
      razorpayKeySecret,
      razorpayWebhookSecret,
      ticketSigningSecret,
      emailApiKey,
    ],
  },
  createApp({ checkoutService, paymentService, webhookService, ticketService, adminRouter, logger }),
);

export const expireReservations = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'asia-south1',
    timeZone: 'Asia/Kolkata',
    timeoutSeconds: 300,
    memory: '256MiB',
    retryCount: 1,
  },
  async () => {
    const result = await expirationService.expirePendingReservations();
    logger.info('Reservation expiration sweep complete.', result);
  },
);
