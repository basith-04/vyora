import { createCsv } from '../functions/src/utils/csv.js';
import { checkpoints, groupLabel } from './attendanceConfig.js';
import { workshopLabels } from './adminData.js';

export function canExportAttendance(summary) {
  return Boolean(summary && Array.isArray(summary.scannedParticipants) && Array.isArray(summary.remaining)
    && summary.scannedParticipants.length === summary.scanned && summary.remaining.length === summary.remainingCount
    && summary.scanned + summary.remainingCount === summary.expected);
}

export function attendanceCsv(summary) {
  if (!canExportAttendance(summary)) throw new Error('Refresh attendance before downloading CSV.');
  const workshop = summary.type === 'WORKSHOP';
  const headers = ['Registration ID', 'Full Name', 'Phone Number', 'Accommodation', 'Workshop', 'Attendance Status', 'Checked In At',
    ...(workshop ? ['Day 1 Status'] : [])];
  const rows = [...summary.scannedParticipants.map((participant) => ({ participant, status: 'SCANNED' })),
    ...summary.remaining.map((participant) => ({ participant, status: 'PENDING' }))];
  rows.sort((a, b) => a.participant.fullName.localeCompare(b.participant.fullName)
    || a.participant.registrationId.localeCompare(b.participant.registrationId));
  return createCsv(headers, rows.map(({ participant: p, status }) => [p.registrationId, p.fullName, p.phone ?? '',
    p.accommodationGroup === 'STAY' ? `STAY${p.stayType === 'AC' ? ' • AC' : p.stayType === 'NON_AC' ? ' • NON-AC' : ''}`
      : p.accommodationGroup ? groupLabel(p.accommodationGroup).toUpperCase() : 'NO STAY',
    workshop ? workshopLabels[p.workshopId] || p.workshopId || '' : '', status, status === 'SCANNED' ? p.checkedInAt ?? '' : '',
    ...(workshop ? [p.day1Absent === true ? 'ABSENT' : p.day1Absent === false ? 'PRESENT' : ''] : [])]));
}

export function attendanceFilename(summary, date = new Date()) {
  const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const label = summary.type === 'WORKSHOP' ? 'workshop' : checkpoints.find((item) => item.type === summary.type)?.label || summary.type;
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `vyora-${[label, summary.workshopId, summary.accommodationGroup].filter(Boolean).map(slug).join('-')}-${day}.csv`;
}

export function downloadAttendanceCsv(summary, { documentRef = globalThis.document, urlApi = globalThis.URL, date = new Date() } = {}) {
  const blob = new Blob([`\uFEFF${attendanceCsv(summary)}`], { type: 'text/csv;charset=utf-8' });
  const url = urlApi.createObjectURL(blob);
  try {
    const anchor = documentRef.createElement('a');
    anchor.href = url; anchor.download = attendanceFilename(summary, date); anchor.rel = 'noopener';
    documentRef.body.appendChild(anchor); anchor.click(); anchor.remove();
    return anchor.download;
  } finally { globalThis.setTimeout(() => urlApi.revokeObjectURL(url), 0); }
}
