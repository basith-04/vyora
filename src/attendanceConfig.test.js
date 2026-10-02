import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { accommodationGroups, checkpoints, groupLabel } from './attendanceConfig.js';

test('one attendance selector contains the six approved checkpoints by day', () => {
  assert.deepEqual(checkpoints.map((item) => [item.type, item.day]), [
    ['EVENT', 1], ['DAY1_CHECK_OUT', 1], ['WORKSHOP', 2],
    ['FIELD_TRIP_DEPARTURE', 2], ['FIELD_TRIP_RETURN', 2], ['DAY2_CHECK_OUT', 2],
  ]);
  assert.equal(checkpoints.filter((item) => item.workshop).length, 1);
  assert.deepEqual(checkpoints.filter((item) => item.checkout).map((item) => item.type), ['DAY1_CHECK_OUT', 'DAY2_CHECK_OUT']);
});

test('checkout selector uses exactly the operational groups and combines stay types', () => {
  assert.deepEqual(accommodationGroups, [
    ['ALL', 'All'], ['SANJOSE', 'Sanjose'], ['SANTHOME', 'Santhome'],
    ['HOLY_CROSS', 'Holy Cross'], ['ALPHONSA', 'Alphonsa'],
    ['PG_HOUSE_NEAR_COLLEGE', 'PG / House Near College'], ['STAY', 'Stay'],
  ]);
  assert.equal(groupLabel('STAY'), 'Stay');
});

test('the Attendance page initially renders one day-grouped checkpoint selector', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: new EventEmitter() } }, appType: 'custom' });
  try {
    const { default: CheckInView } = await vite.ssrLoadModule('/src/CheckInView.jsx');
    const html = renderToStaticMarkup(React.createElement(CheckInView, { auth: null }));
    assert.match(html, /<h2>ATTENDANCE<\/h2>/);
    assert.match(html, /<h3>DAY 1<\/h3>/);
    assert.match(html, /<h3>DAY 2<\/h3>/);
    assert.equal((html.match(/<button type="button">/g) || []).length, 6);
    assert.doesNotMatch(html, /qr-scanner|Back to Checkpoints/);
  } finally { await vite.close(); }
});
