import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { copyParticipantPhone, participantContact } from './participantContact.js';

test('contact links use the stored number and preserve country codes without adding one', () => {
  assert.deepEqual(participantContact('9876543210'), { number: '9876543210', href: 'tel:9876543210' });
  assert.deepEqual(participantContact('+91 98765-43210'), { number: '+91 98765-43210', href: 'tel:+919876543210' });
  assert.deepEqual(participantContact('+44 (20) 7946 0958'), { number: '+44 (20) 7946 0958', href: 'tel:+442079460958' });
});

test('missing and malformed phone values never produce a dialer link', () => {
  for (const phone of [undefined, null, '', ' ', 9876543210, '123', '9876543210123456',
    'javascript:alert(1)', '9876543210;123', '9876543210#', '9876543210 ext 1', '++919876543210', '+0123456789']) {
    assert.equal(participantContact(phone), null);
  }
});

test('COPY writes the canonical displayed phone number to the clipboard', async () => {
  const copied = [];
  const clipboard = { async writeText(value) { copied.push(value); } };
  assert.equal(await copyParticipantPhone('9876543210', clipboard), true);
  assert.equal(await copyParticipantPhone('+91 98765-43210', clipboard), true);
  assert.deepEqual(copied, ['9876543210', '+91 98765-43210']);
});

test('COPY failure/unavailability is safe and malformed values are not copied', async () => {
  assert.equal(await copyParticipantPhone('9876543210', null), false);
  assert.equal(await copyParticipantPhone('9876543210', { writeText: async () => { throw new Error('Denied'); } }), false);
  let called = false;
  assert.equal(await copyParticipantPhone('invalid', { writeText() { called = true; } }), false);
  assert.equal(called, false);
});

test('pending participant renders a compact disclosure with independent contact actions and existing group', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: new EventEmitter() } }, appType: 'custom' });
  try {
    const { default: PendingParticipant } = await vite.ssrLoadModule('/src/PendingParticipant.jsx');
    const participant = { fullName: 'Participant With A Long Name', registrationId: 'VYR26-CONTACT', phone: '+91 98765-43210', accommodationGroup: 'SANTHOME' };
    const html = renderToStaticMarkup(React.createElement(PendingParticipant, { participant, checkout: true }));
    assert.match(html, /<details class="pending-contact"><summary>/);
    assert.doesNotMatch(html, /<details[^>]*open|CHECK IN|CHECK-IN/);
    assert.match(html, /Participant With A Long Name/); assert.match(html, /VYR26-CONTACT/); assert.match(html, /Santhome/);
    assert.match(html, /href="tel:\+919876543210"/); assert.match(html, />CALL<\/a>/);
    assert.match(html, /type="button" class="secondary-button">COPY NUMBER/);
  } finally { await vite.close(); }
});

test('unusable pending phone disables both actions and renders a clear message', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: new EventEmitter() } }, appType: 'custom' });
  try {
    const { default: PendingParticipant } = await vite.ssrLoadModule('/src/PendingParticipant.jsx');
    for (const phone of [undefined, 'not-a-number']) {
      const html = renderToStaticMarkup(React.createElement(PendingParticipant, { participant: { fullName: 'Participant', registrationId: 'VYR26-INVALID', phone } }));
      assert.match(html, /Phone number unavailable or invalid/);
      assert.match(html, /disabled="">CALL/); assert.match(html, /disabled="">COPY NUMBER/);
      assert.doesNotMatch(html, /href="tel:/);
    }
  } finally { await vite.close(); }
});

test('Workshop pending rows show only derived Day 1 absence while preserving contact actions', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: new EventEmitter() } }, appType: 'custom' });
  try {
    const { default: PendingParticipant } = await vite.ssrLoadModule('/src/PendingParticipant.jsx');
    for (const day1Absent of [true, false, undefined]) {
      const html = renderToStaticMarkup(React.createElement(PendingParticipant, { participant: {
        fullName: 'Workshop Participant', registrationId: 'VYR26-WORKSHOP', phone: '9876543210', day1Absent,
      } }));
      assert.equal(html.includes('DAY 1 ABSENT'), day1Absent === true);
      assert.match(html, /href="tel:9876543210"/);
      assert.match(html, /COPY NUMBER/);
    }
  } finally { await vite.close(); }
});
