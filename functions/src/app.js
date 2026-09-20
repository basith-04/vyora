import express from 'express';
import { AppError } from './errors.js';
import { hashRecoveryToken, readRecoveryToken } from './utils/recovery-token.js';

function registrationTokenHash(request) {
  return hashRecoveryToken(readRecoveryToken(request));
}

function registrationIdFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.registrationId !== 'string') {
    throw new AppError('INVALID_PARTICIPANT_DATA', 'A registration ID is required.', 400);
  }
  return body.registrationId;
}

function ticketViewTokenFromBody(body) {
  if (
    !body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || typeof body.ticketViewToken !== 'string'
  ) {
    throw new AppError('TICKET_VIEW_INVALID', 'A valid ticket link is required.', 400);
  }
  return body.ticketViewToken;
}

export function createApp({ checkoutService, paymentService, webhookService, ticketService, adminRouter, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  // Razorpay signs the exact request bytes. Register this before the JSON parser.
  app.post(
    '/api/webhooks/razorpay',
    express.raw({ type: 'application/json', limit: '256kb' }),
    async (request, response, next) => {
      try {
        const result = await webhookService.handleWebhook({
          rawBody: request.body,
          signature: request.get('x-razorpay-signature'),
          eventId: request.get('x-razorpay-event-id'),
        });
        response.status(200).json({ data: { received: true, outcome: result.outcome } });
      } catch (error) {
        next(error);
      }
    },
  );

  app.use(express.json({ limit: '16kb', strict: true }));

  if (adminRouter) app.use('/api/admin', adminRouter);

  app.post('/api/registrations', async (request, response, next) => {
    try {
      const data = await checkoutService.start(request.body, registrationTokenHash(request));
      response.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/registrations/retry', async (request, response, next) => {
    try {
      const data = await checkoutService.retry(
        registrationIdFromBody(request.body),
        registrationTokenHash(request),
      );
      response.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/registrations/status', async (request, response, next) => {
    try {
      const data = await checkoutService.status(
        typeof request.body?.registrationId === 'string' ? request.body.registrationId : null,
        registrationTokenHash(request),
      );
      response.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/payments/verify', async (request, response, next) => {
    try {
      const data = await paymentService.verifyFromFrontend(
        request.body,
        registrationTokenHash(request),
      );
      response.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/registrations/ticket', async (request, response, next) => {
    try {
      const registrationId = registrationIdFromBody(request.body);
      const data = await ticketService.participantTicket(registrationId, registrationTokenHash(request));
      response.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/tickets/view', async (request, response, next) => {
    try {
      const data = await ticketService.viewByToken(ticketViewTokenFromBody(request.body));
      response.status(200).json({ data });
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
      const isInternal = error.code === 'INTERNAL_ERROR';
      if (error.status >= 500) {
        logger.error('Registration/payment API error', {
          code: error.code, operation: request.path, result: 'failed',
        });
      }
      const payload = {
        code: error.code,
        message: isInternal ? 'The request could not be processed.' : error.message,
      };
      if (!isInternal && error.details) payload.details = error.details;
      return response.status(error.status).json({ error: payload });
    }

    logger.error('Unhandled registration/payment API error', error);
    return response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'The request could not be processed.' },
    });
  });

  return app;
}
