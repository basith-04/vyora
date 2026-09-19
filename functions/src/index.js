import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { db } from './firebase.js';
import { createApp } from './app.js';
import { createRegistrationService } from './services/registration.js';
import { createExpirationService } from './services/expiration.js';

const createRegistration = createRegistrationService({ db });
const expirationService = createExpirationService({ db });

export const api = onRequest(
  { region: 'asia-south1', timeoutSeconds: 30, memory: '256MiB' },
  createApp({ createRegistration, logger }),
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
