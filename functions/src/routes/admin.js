import { Router } from 'express';
import { requireAdminRole } from '../middleware/admin-auth.js';

export function createAdminRouter({
  authorizeAdmin, reportingService, checkinService, confirmationEmailService,
  manualReconciliationService, ticketEditService, ticketTransferService, manualTicketService,
}) {
  const router = Router();
  router.use(authorizeAdmin);

  router.get('/me', (request, response) => {
    const { name, email, role } = request.admin;
    response.json({ data: { name, email, role } });
  });

  router.get('/dashboard', async (request, response, next) => {
    try {
      response.json({ data: await reportingService.dashboard() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/tickets', requireAdminRole, async (request, response, next) => {
    try {
      response.json({ data: await reportingService.tickets() });
    } catch (error) {
      next(error);
    }
  });

  if (manualTicketService) {
    router.post('/manual-tickets', requireAdminRole, async (request, response, next) => {
      try { response.status(201).json({ data: await manualTicketService.create(request.body, request.admin) }); }
      catch (error) { next(error); }
    });
  }

  if (ticketEditService) {
    router.get('/edit-ticket/:registrationId', requireAdminRole, async (request, response, next) => {
      try { response.json({ data: await ticketEditService.detail(request.params.registrationId, request.admin) }); }
      catch (error) { next(error); }
    });
    router.post('/edit-ticket/:registrationId', requireAdminRole, async (request, response, next) => {
      try { response.json({ data: await ticketEditService.apply(request.params.registrationId, request.body, request.admin) }); }
      catch (error) { next(error); }
    });
  }

  if (ticketTransferService) {
    router.get('/transfer-ticket/:registrationId', requireAdminRole, async (request, response, next) => {
      try { response.json({ data: await ticketTransferService.detail(request.params.registrationId, request.admin) }); }
      catch (error) { next(error); }
    });
    router.post('/transfer-ticket/:registrationId', requireAdminRole, async (request, response, next) => {
      try { response.json({ data: await ticketTransferService.apply(request.params.registrationId, request.body, request.admin) }); }
      catch (error) { next(error); }
    });
  }

  router.get('/registrations', async (request, response, next) => {
    try {
      response.json({ data: { registrations: await reportingService.registrations() } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/registrations/:registrationId', async (request, response, next) => {
    try {
      response.json({ data: await reportingService.registration(request.params.registrationId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/export/registrations.csv', async (request, response, next) => {
    try {
      response.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="vyora-26-registrations.csv"',
      });
      response.status(200).send(`\uFEFF${await reportingService.csv(request.query)}`);
    } catch (error) {
      next(error);
    }
  });

  if (checkinService) {
    router.post('/check-ins', async (request, response, next) => {
      try {
        response.status(200).json({ data: await checkinService.checkIn(request.body, request.admin) });
      } catch (error) {
        next(error);
      }
    });
  }

  if (confirmationEmailService) {
    router.get('/registrations/:registrationId/ticket-email', requireAdminRole, async (request, response, next) => {
      try { response.json({ data: await confirmationEmailService.resendDetail(request.params.registrationId, request.admin) }); }
      catch (error) { next(error); }
    });
    router.post('/registrations/:registrationId/ticket-email/resend', requireAdminRole, async (request, response, next) => {
      try { response.json({ data: await confirmationEmailService.resendByRegistrationId(request.params.registrationId, request.body, request.admin) }); }
      catch (error) { next(error); }
    });

    router.post('/registrations/:registrationId/confirmation-email/retry', async (request, response, next) => {
      try {
        const data = await confirmationEmailService.retryByRegistrationId(request.params.registrationId);
        response.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    });
  }

  if (manualReconciliationService) {
    router.post(
      '/registrations/:registrationId/reconcile-payment',
      requireAdminRole,
      async (request, response, next) => {
        try {
          const data = await manualReconciliationService.reconcile(
            request.params.registrationId,
            request.admin,
          );
          response.status(200).json({ data });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  return router;
}
