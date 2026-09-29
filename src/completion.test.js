import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationApi } from './registrationApi.js';
import { completionErrors } from '../functions/shared/completion.js';
test('completion client submits only form values and receives only minimal result', async () => {
  const original = globalThis.fetch;
  const input = { registrationId: 'VYR26-ABCDEFGHIJKLMNOPQRST', termsAccepted: true, gender: 'FEMALE', foodPreference: 'NON_VEG', healthSafetyConcern: false, healthSafetyNote: null };
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

test('completion shared validation requires explicit terms acceptance without changing other validation', () => {
  const valid = { registrationId: 'VYR26-ABCDEFGHIJKLMNOPQRST', gender: 'MALE', foodPreference: 'VEG', healthSafetyConcern: false, termsAccepted: true };
  assert.deepEqual(completionErrors(valid), {});
  for (const termsAccepted of [undefined, false, null, 'true', 1, [], {}]) {
    assert.deepEqual(completionErrors({ ...valid, termsAccepted }), { termsAccepted: 'You must accept the Terms & Conditions before submitting.' });
  }
  assert.ok(completionErrors({ ...valid, gender: '' }).gender);
});

test('completion page renders required unchecked checkbox immediately before submit and links to the existing Terms route', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' });
  try {
    const { default: Page } = await server.ssrLoadModule('/src/CompleteRegistrationPage.jsx');
    const { default: React } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = renderToStaticMarkup(React.createElement(Page));
    assert.match(html, /<input[^>]*id="termsAccepted"[^>]*type="checkbox"[^>]*required=""/);
    assert.doesNotMatch(html.match(/<input[^>]*id="termsAccepted"[^>]*>/)[0], /checked=/);
    assert.match(html, /<a href="\/terms-and-conditions" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions<\/a>/);
    assert.ok(html.indexOf('id="termsAccepted"') < html.indexOf('class="registration-submit"'));
    const { informationPaths } = await server.ssrLoadModule('/src/InformationPages.jsx');
    assert.ok(informationPaths.has('/terms-and-conditions'));
  } finally { await server.close(); }
});
