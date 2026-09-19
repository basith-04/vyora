import { Router } from 'express';

export function createAdminRouter({ authorizeAdmin, reportingService }) {
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
      response.status(200).send(`\uFEFF${await reportingService.csv()}`);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
