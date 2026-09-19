import express from 'express';
import { AppError } from './errors.js';

function serializeRegistration(registration) {
  return {
    registrationId: registration.registrationId,
    registrationStatus: registration.registrationStatus,
    paymentStatus: registration.paymentStatus,
    workshopId: registration.workshopId,
    pricing: registration.pricing,
    seatReservationExpiresAt: registration.seatReservationExpiresAt.toDate().toISOString(),
  };
}

export function createApp({ createRegistration, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));

  app.post('/api/registrations', async (request, response, next) => {
    try {
      const registration = await createRegistration(request.body);
      response.status(201).json({ data: serializeRegistration(registration) });
    } catch (error) {
      next(error);
    }
  });

  app.use((request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' },
    });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return response.status(400).json({
        error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' },
      });
    }
    if (error?.type === 'entity.too.large') {
      return response.status(413).json({
        error: { code: 'INVALID_PARTICIPANT_DATA', message: 'The request body is too large.' },
      });
    }
    if (error instanceof AppError) {
      const isInternal = error.status >= 500;
      if (isInternal) logger.error('Registration service error', error);
      const payload = {
        code: error.code,
        message: isInternal ? 'The registration could not be processed.' : error.message,
      };
      if (!isInternal && error.details) payload.details = error.details;
      return response.status(error.status).json({ error: payload });
    }

    logger.error('Unhandled registration API error', error);
    return response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'The registration could not be processed.' },
    });
  });

  return app;
}
