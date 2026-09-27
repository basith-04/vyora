import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { validateCompletion } from '../../src/services/complete-registration.js';
import { publicRegistration, registrationsCsv } from '../../src/services/admin-reporting.js';
const valid = { registrationId: 'VYR26-ABCDEFGHIJKLMNOPQRST', gender: 'MALE', foodPreference: 'VEG', healthSafetyConcern: false };
test('completion validates canonical options and conditional short health text', () => {
  for (const gender of ['MALE', 'FEMALE']) for (const foodPreference of ['VEG', 'NON_VEG']) {
    assert.equal(validateCompletion({ ...valid, gender, foodPreference }).healthSafetyNote, null);
  }
  for (const input of [{ gender: 'OTHER' }, { foodPreference: 'vegan' }, { healthSafetyConcern: 'NO' }, { healthSafetyConcern: true }, { healthSafetyConcern: true, healthSafetyNote: ' ' }, { healthSafetyConcern: true, healthSafetyNote: 'x'.repeat(301) }, { paymentStatus: 'PAID' }, { fullName: 'Change' }, { detailsCompletedAt: 'now' }]) {
    assert.throws(() => validateCompletion({ ...valid, ...input }), { code: 'INVALID_COMPLETION' });
  }
  assert.equal(validateCompletion({ ...valid, healthSafetyNote: 'discard me' }).healthSafetyNote, null);
  assert.equal(validateCompletion({ ...valid, healthSafetyConcern: true, healthSafetyNote: '  assistance  ' }).healthSafetyNote, 'assistance');
});
test('endpoint explicitly projects minimal success, missing and completed responses', async () => {
  for (const result of [{ success: true }, { success: false, code: 'REGISTRATION_NOT_FOUND' }, { success: false, code: 'ALREADY_COMPLETED' }]) {
    const app = createApp({ completionService: { limit: async () => {}, submit: async () => ({ ...result, fullName: 'SECRET', registrationDocId: 'internal', healthSafetyNote: 'SECRET' }) } });
    const response = await request(app).post('/api/complete-registration').send(valid);
    assert.deepEqual(response.body, result);
  }
});
test('endpoint validation and internal failures never return or log health text', async () => {
  const logs = [];
  const app = createApp({ logger: { error: (...args) => logs.push(args) }, completionService: { limit: async () => {}, submit: async () => { throw new Error('SECRET HEALTH TEXT'); } } });
  const response = await request(app).post('/api/complete-registration').send({ ...valid, healthSafetyNote: 'SECRET HEALTH TEXT' });
  assert.deepEqual(response.body, { success: false, code: 'INTERNAL_ERROR' });
  assert.equal(JSON.stringify(logs).includes('SECRET'), false);
});
test('generic admin serialization and CSV exclude completion and health information', () => {
  const registration = { ...valid, fullName: 'Participant', healthSafetyNote: 'PRIVATE_HEALTH', healthSafetyConcern: true };
  assert.equal(JSON.stringify(publicRegistration(registration)).includes('PRIVATE_HEALTH'), false);
  assert.equal(Object.hasOwn(publicRegistration(registration), 'healthSafetyConcern'), false);
  assert.equal(registrationsCsv([registration]).includes('PRIVATE_HEALTH'), false);
});
test('endpoint returns field-level errors and rate limits before registration lookup', async () => {
  let lookups = 0;
  const invalidApp = createApp({ completionService: { limit: async () => {}, submit: async (value) => validateCompletion(value) } });
  const invalid = await request(invalidApp).post('/api/complete-registration').send({ ...valid, gender: 'invalid' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.fields.gender, 'Select Male or Female.');
  const { AppError } = await import('../../src/errors.js');
  const app = createApp({ completionService: { limit: async () => { throw new AppError('RATE_LIMITED', 'wait', 429); }, submit: async () => { lookups++; } } });
  const response = await request(app).post('/api/complete-registration').send(valid);
  assert.equal(response.status, 429);
  assert.deepEqual(response.body, { success: false, code: 'RATE_LIMITED' });
  assert.equal(lookups, 0);
});

test('public endpoint keys protection by submitted values, never the network address', async () => {
  const seen = [];
  const app = createApp({ completionService: {
    limit: async (value) => seen.push(value), submit: async () => ({ success: true }),
  } });
  for (const registrationId of [valid.registrationId, 'VYR26-ZZZZZZZZZZZZZZZZZZZZ']) {
    const input = { ...valid, registrationId };
    const response = await request(app).post('/api/complete-registration').set('X-Forwarded-For', '203.0.113.1').send(input);
    assert.deepEqual(response.body, { success: true });
    assert.deepEqual(seen.at(-1), input);
  }
});
