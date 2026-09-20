import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
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

const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');
const razorpayWebhookSecret = defineSecret('RAZORPAY_WEBHOOK_SECRET');
const ticketSigningSecret = defineSecret('TICKET_SIGNING_SECRET');

const createRegistration = createRegistrationService({ db });
const expirationService = createExpirationService({ db });
const razorpay = createRazorpayGateway({
  getKeyId: () => razorpayKeyId.value(),
  getKeySecret: () => razorpayKeySecret.value(),
});
const checkoutService = createCheckoutService({
  db, createRegistration, expirationService, razorpay, logger,
});
const ticketService = createTicketService({
  db,
  getSigningSecret: () => ticketSigningSecret.value(),
});
const paymentService = createPaymentService({
  db, razorpay, getKeySecret: () => razorpayKeySecret.value(), ticketService, logger,
});
const webhookService = createWebhookService({
  paymentService,
  getWebhookSecret: () => razorpayWebhookSecret.value(),
  logger,
});
const adminRouter = createAdminRouter({
  authorizeAdmin: createAdminAuthorization({ auth, db }),
  reportingService: createAdminReportingService({ db }),
  checkinService: createCheckinService({ db, ticketService }),
});

export const api = onRequest(
  {
    region: 'asia-south1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [razorpayKeyId, razorpayKeySecret, razorpayWebhookSecret, ticketSigningSecret],
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
