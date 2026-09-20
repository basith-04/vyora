import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadFullTicket, renderFullTicketPng } from './ticketImage.js';

const ticket = {
  ticketId: 'TKT-001',
  ticketPayload: `vyora26:t:${'A'.repeat(43)}`,
  participant: {
    fullName: 'Mobile Participant', registrationId: 'VYR26-ABCDEFGHIJKLMNOPQRST',
    ieeeMember: true, workshopId: 'github-ai',
  },
};

function fakeDocument() {
  const texts = [];
  const anchors = [];
  const context = {
    fillStyle: '', strokeStyle: '', font: '', lineWidth: 0, textAlign: 'start',
    fillRect() {}, strokeRect() {}, drawImage() {},
    fillText(value) { texts.push(String(value)); },
  };
  return {
    texts,
    anchors,
    body: { appendChild() {} },
    fonts: { ready: Promise.resolve() },
    createElement(type) {
      if (type === 'a') {
        const anchor = { clickCalled: false, click() { this.clickCalled = true; }, remove() {} };
        anchors.push(anchor);
        return anchor;
      }
      return {
        width: 0, height: 0,
        getContext: () => context,
        toBlob: (callback) => callback(new Blob(['complete-ticket'], { type: 'image/png' })),
      };
    },
  };
}

test('complete ticket PNG includes branded participant details and unchanged high-resolution QR payload', async () => {
  const documentRef = fakeDocument();
  let qrCall;
  const blob = await renderFullTicketPng(ticket, {
    documentRef,
    qrRenderer: async (canvas, payload, options) => { qrCall = { canvas, payload, options }; },
  });
  assert.equal(blob.type, 'image/png');
  assert.equal(qrCall.payload, ticket.ticketPayload);
  assert.equal(qrCall.options.width, 480);
  assert.equal(qrCall.options.errorCorrectionLevel, 'H');
  assert.ok(documentRef.texts.includes("VYORA '26"));
  assert.ok(documentRef.texts.includes(ticket.participant.fullName));
  assert.ok(documentRef.texts.includes(ticket.participant.registrationId));
  assert.equal(documentRef.texts.includes(ticket.ticketPayload), false);
});

test('mobile-compatible download uses a complete PNG and participant-facing filename', async () => {
  const documentRef = fakeDocument();
  let revoked;
  const filename = await downloadFullTicket(ticket, {
    documentRef,
    render: async () => new Blob(['png'], { type: 'image/png' }),
    urlApi: { createObjectURL: () => 'blob:ticket', revokeObjectURL: (url) => { revoked = url; } },
  });
  assert.equal(filename, 'VYORA26-VYR26-ABCDEFGHIJKLMNOPQRST-Ticket.png');
  assert.equal(documentRef.anchors[0].clickCalled, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(revoked, 'blob:ticket');
});
