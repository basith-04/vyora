import QRCode from 'qrcode';
import { workshopLabels } from './adminData.js';

const WIDTH = 1400;
const HEIGHT = 900;

function assertTicket(ticket) {
  if (
    !ticket?.participant?.registrationId
    || !ticket?.participant?.fullName
    || !ticket?.ticketId
    || typeof ticket.ticketPayload !== 'string'
    || !/^vyora26:t:[A-Za-z0-9_-]{43}$/.test(ticket.ticketPayload)
  ) throw new Error('The ticket data is incomplete.');
}

function label(context, text, x, y) {
  context.fillStyle = '#547073';
  context.font = '600 20px "IBM Plex Mono", monospace';
  context.fillText(text, x, y);
}

function value(context, text, x, y, maxWidth, size = 34) {
  context.fillStyle = '#071c2c';
  context.font = `700 ${size}px "IBM Plex Mono", monospace`;
  context.fillText(String(text), x, y, maxWidth);
}

export async function renderFullTicketPng(ticket, {
  documentRef = globalThis.document,
  qrRenderer = QRCode.toCanvas,
} = {}) {
  assertTicket(ticket);
  if (!documentRef?.createElement) throw new Error('Ticket image generation is unavailable.');
  await documentRef.fonts?.ready;
  const canvas = documentRef.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Ticket image generation is unavailable.');

  context.fillStyle = '#fffdf5';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = '#0a3942';
  context.fillRect(0, 0, WIDTH, 170);
  context.fillStyle = '#46d7df';
  context.font = '700 48px Bungee, sans-serif';
  context.fillText("VYORA '26", 70, 78);
  context.fillStyle = '#fffdf5';
  context.font = '700 30px "IBM Plex Mono", monospace';
  context.fillText('ENTRY TICKET', 1020, 78);
  context.font = '600 20px "IBM Plex Mono", monospace';
  context.fillText('09–10 OCTOBER 2026 · VJEC CHEMPERI', 70, 130);

  label(context, 'PARTICIPANT', 70, 235);
  value(context, ticket.participant.fullName, 70, 285, 690, 42);
  label(context, 'REGISTRATION ID', 70, 355);
  value(context, ticket.participant.registrationId, 70, 398, 690, 30);
  label(context, 'CATEGORY', 70, 470);
  value(context, ticket.participant.ieeeMember ? 'IEEE MEMBER' : 'NON-IEEE PARTICIPANT', 70, 513, 690, 28);
  label(context, 'WORKSHOP', 70, 585);
  value(context, workshopLabels[ticket.participant.workshopId] || ticket.participant.workshopId, 70, 628, 690, 27);
  label(context, 'TICKET ID', 70, 700);
  value(context, ticket.ticketId, 70, 743, 690, 27);

  const qrCanvas = documentRef.createElement('canvas');
  await qrRenderer(qrCanvas, ticket.ticketPayload, {
    errorCorrectionLevel: 'H', width: 480, margin: 3,
    color: { dark: '#071c2cff', light: '#ffffffff' },
  });
  context.fillStyle = '#ffffff';
  context.fillRect(840, 220, 490, 490);
  context.strokeStyle = '#9ab0aa';
  context.lineWidth = 3;
  context.strokeRect(840, 220, 490, 490);
  context.drawImage(qrCanvas, 845, 225, 480, 480);
  context.fillStyle = '#f1ead7';
  context.fillRect(0, 800, WIDTH, 100);
  context.fillStyle = '#93401e';
  context.font = '700 23px "IBM Plex Mono", monospace';
  context.textAlign = 'center';
  context.fillText('SHOW THIS QR AT THE EVENT ENTRANCE', WIDTH / 2, 842);
  context.fillStyle = '#344e53';
  context.font = '500 18px "IBM Plex Mono", monospace';
  context.fillText('USE THE SAME QR FOR YOUR REGISTERED WORKSHOP CHECK-IN', WIDTH / 2, 874);
  context.textAlign = 'start';
  context.strokeStyle = '#071c2c';
  context.lineWidth = 8;
  context.strokeRect(4, 4, WIDTH - 8, HEIGHT - 8);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Ticket image generation failed.')), 'image/png');
  });
}

export async function downloadFullTicket(ticket, {
  documentRef = globalThis.document,
  urlApi = globalThis.URL,
  render = renderFullTicketPng,
} = {}) {
  const blob = await render(ticket, { documentRef });
  const url = urlApi.createObjectURL(blob);
  try {
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = `VYORA26-${ticket.participant.registrationId}-Ticket.png`;
    anchor.rel = 'noopener';
    documentRef.body?.appendChild(anchor);
    anchor.click();
    anchor.remove?.();
    return anchor.download;
  } finally {
    globalThis.setTimeout(() => urlApi.revokeObjectURL(url), 0);
  }
}
