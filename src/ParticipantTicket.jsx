import React, { useEffect, useState } from 'react';
import { renderTicketQr } from './ticketQr.js';
import { workshopLabels } from './adminData.js';

export default function ParticipantTicket({ ticket, loading, error, onRetry }) {
  const [qrImage, setQrImage] = useState('');
  const [qrError, setQrError] = useState('');

  useEffect(() => {
    let active = true;
    setQrImage('');
    setQrError('');
    if (!ticket?.ticketPayload) return undefined;
    renderTicketQr(ticket.ticketPayload)
      .then((image) => { if (active) setQrImage(image); })
      .catch(() => { if (active) setQrError('The QR image could not be rendered.'); });
    return () => { active = false; };
  }, [ticket?.ticketPayload]);

  if (loading) return <section className="participant-ticket ticket-loading"><div className="ticket-spinner" /><strong>ISSUING YOUR TICKET…</strong><p>Your payment is already confirmed. Ticket issuance can be retried safely.</p></section>;
  if (error || qrError) return <section className="participant-ticket ticket-error" role="alert"><strong>TICKET TEMPORARILY UNAVAILABLE</strong><p>{error || qrError}</p><button type="button" onClick={onRetry}>LOAD TICKET AGAIN</button></section>;
  if (!ticket) return null;

  return <section className="participant-ticket" aria-labelledby="participant-ticket-title">
    <div className="ticket-header"><span>VYORA '26</span><strong id="participant-ticket-title">ENTRY TICKET</strong><small>09—10 OCT 2026 · VJEC CHEMPERI</small></div>
    <div className="ticket-body">
      <div className="ticket-identity"><span>PARTICIPANT</span><strong>{ticket.participant.fullName}</strong><span>REGISTRATION</span><b>{ticket.participant.registrationId}</b><span>WORKSHOP</span><b>{workshopLabels[ticket.participant.workshopId] || ticket.participant.workshopId}</b><span>TICKET</span><b>{ticket.ticketId}</b></div>
      <div className="ticket-qr">{qrImage ? <img src={qrImage} alt={`QR ticket for ${ticket.participant.fullName}`} /> : <div className="ticket-spinner" aria-label="Rendering QR code" />}</div>
    </div>
    <div className="ticket-instructions"><strong>SHOW THIS QR AT THE EVENT ENTRANCE.</strong><span>Use the same QR code for workshop check-in. Save it or take a screenshot before arriving.</span></div>
    {qrImage && <a className="ticket-download" href={qrImage} download={`VYORA26-${ticket.participant.registrationId}-ticket.png`}>SAVE QR IMAGE ↓</a>}
  </section>;
}
