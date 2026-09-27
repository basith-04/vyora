import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationApi } from './registrationApi.js';
import { completionErrors } from '../functions/shared/completion.js';
test('completion client submits only form values and receives only minimal result', async () => {
  const original = globalThis.fetch;
  const input = { registrationId: 'VYR26-ABCDEFGHIJKLMNOPQRST', gender: 'FEMALE', foodPreference: 'NON_VEG', healthSafetyConcern: false, healthSafetyNote: null };
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/api/complete-registration');
    assert.deepEqual(JSON.parse(options.body), input);
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    return { ok: true, json: async () => ({ success: true }) };
  };
  try { assert.deepEqual(await registrationApi.complete(input), { success: true }); } finally { globalThis.fetch = original; }
  assert.deepEqual(completionErrors(input), {});
  assert.ok(completionErrors({ ...input, healthSafetyConcern: true }).healthSafetyNote);
});
