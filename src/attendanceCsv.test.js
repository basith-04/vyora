import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceCsv, attendanceFilename, canExportAttendance, downloadAttendanceCsv } from './attendanceCsv.js';

const timestamp = '2026-10-10T03:15:00.000Z';
const participant = { registrationId: 'VYR26-A', fullName: 'Attended Participant', phone: '9876543210',
  accommodationGroup: 'STAY', stayType: 'NON_AC', workshopId: 'github-ai', day1Absent: false };
const pending = { ...participant, registrationId: 'VYR26-B', fullName: 'Pending Participant', day1Absent: true, checkedInAt: 'IGNORE PENDING TIMESTAMP' };
const summary = (selection = {}) => ({ type: 'EVENT', workshopId: null, accommodationGroup: null, expected: 2, scanned: 1,
  remainingCount: 1, scannedParticipants: [{ ...participant, checkedInAt: timestamp }], remaining: [pending], ...selection });

for (const selection of [{ type: 'EVENT' }, { type: 'DAY1_CHECK_OUT', accommodationGroup: 'SANTHOME' },
  { type: 'WORKSHOP', workshopId: 'github-ai' }, { type: 'FIELD_TRIP_DEPARTURE' }, { type: 'FIELD_TRIP_RETURN' },
  { type: 'DAY2_CHECK_OUT', accommodationGroup: 'STAY' }]) test(`${selection.type} exports exactly its supplied authoritative scanned/pending population`, () => {
  const data = summary(selection); const before = structuredClone(data); const csv = attendanceCsv(data);
  const lines = csv.split('\r\n');
  assert.equal(lines.length - 1, data.expected);
  assert.equal(lines.filter((line) => line.includes(',"SCANNED",')).length, data.scanned);
  assert.equal(lines.filter((line) => line.includes(',"PENDING",')).length, data.remainingCount);
  assert.ok(lines[1].includes(timestamp)); assert.doesNotMatch(lines[2], /IGNORE PENDING TIMESTAMP/);
  assert.match(csv, /STAY • NON-AC/);
  if (selection.type === 'WORKSHOP') {
    assert.match(csv, /"Day 1 Status"/); assert.match(csv, /GitHub × AI/);
    assert.match(lines[1], /"PRESENT"$/); assert.match(lines[2], /"ABSENT"$/);
  } else { assert.doesNotMatch(csv, /Day 1 Status|GitHub × AI/); assert.match(lines[2], /,"PENDING",""$/); }
  assert.deepEqual(data, before);
});

test('CSV reuses escaping and protects formulas in every participant cell without leaking extra fields', () => {
  const data = summary(); data.scannedParticipants[0] = { ...participant, checkedInAt: timestamp,
    fullName: 'Name, "quoted"\nsecond line', email: 'PRIVATE EMAIL', healthSafetyNote: 'PRIVATE HEALTH',
    qrTokenHash: 'PRIVATE QR', recoveryToken: 'PRIVATE RECOVERY', razorpayPaymentId: 'PRIVATE PAYMENT' };
  assert.match(attendanceCsv(data), /"Name, ""quoted""\nsecond line"/);
  assert.doesNotMatch(attendanceCsv(data), /PRIVATE|qrTokenHash|recoveryToken|razorpay|healthSafety|email/);
  for (const value of ['=SUM(A1)', '+919876543210', '-formula', '@formula', '  =formula', '\tformula', '\rformula']) {
    data.scannedParticipants[0].fullName = value;
    assert.ok(attendanceCsv(data).includes(`"'${value}"`));
  }
});

test('export readiness rejects incomplete or optimistic summaries and supports an empty population', () => {
  assert.equal(canExportAttendance(null), false); assert.equal(canExportAttendance({ expected: 1, remaining: [pending] }), false);
  const data = summary(); data.remaining = []; assert.equal(canExportAttendance(data), false);
  assert.throws(() => attendanceCsv(data), /Refresh attendance/);
  const empty = summary({ expected: 0, scanned: 0, remainingCount: 0, remaining: [], scannedParticipants: [] });
  assert.equal(canExportAttendance(empty), true); assert.equal(attendanceCsv(empty).split('\r\n').length, 1);
});

test('filename includes current checkpoint, workshop/group and local calendar date with safe characters', () => {
  const date = new Date(2026, 9, 10, 7, 45);
  assert.equal(attendanceFilename(summary(), date), 'vyora-event-check-in-2026-10-10.csv');
  assert.equal(attendanceFilename(summary({ type: 'WORKSHOP', workshopId: 'github-ai' }), date), 'vyora-workshop-github-ai-2026-10-10.csv');
  assert.equal(attendanceFilename(summary({ type: 'DAY2_CHECK_OUT', accommodationGroup: 'STAY' }), date), 'vyora-day-2-check-out-stay-2026-10-10.csv');
  assert.match(attendanceFilename(summary({ workshopId: '../unsafe / <value>' }), date), /^[a-z0-9-]+\.csv$/);
});

test('download creates UTF-8 CSV Blob and clicks a local anchor with zero network requests', async (context) => {
  context.mock.method(globalThis, 'fetch', () => { throw new Error('Download must not request or write data'); });
  context.mock.method(globalThis, 'setTimeout', (callback) => { callback(); return 0; });
  let blob, clicked = 0, removed = 0, revoked;
  const anchor = { click() { clicked++; }, remove() { removed++; } };
  const filename = downloadAttendanceCsv(summary(), {
    date: new Date(2026, 9, 10), documentRef: { createElement: (tag) => { assert.equal(tag, 'a'); return anchor; }, body: { appendChild() {} } },
    urlApi: { createObjectURL(value) { blob = value; return 'blob:attendance'; }, revokeObjectURL(value) { revoked = value; } },
  });
  assert.equal(filename, 'vyora-event-check-in-2026-10-10.csv'); assert.equal(anchor.href, 'blob:attendance');
  assert.equal(clicked, 1); assert.equal(removed, 1); assert.equal(revoked, 'blob:attendance');
  assert.equal(blob.type, 'text/csv;charset=utf-8');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(await blob.text(), /Registration ID/);
});
