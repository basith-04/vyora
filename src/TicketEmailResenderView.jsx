import React, { useMemo, useRef, useState } from 'react';
import ParticipantSearch from './ParticipantSearch.jsx';
import { confirmedParticipantMatches } from './adminData.js';
import { loadTicketEmail, resendTicketEmail } from './adminApi.js';

export default function TicketEmailResenderView({ auth, registrations }) {
  const [search, setSearch] = useState('');
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const inFlight = useRef(false);
  const matches = useMemo(() => confirmedParticipantMatches(registrations, search), [registrations, search]);
  async function select(item) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setSuccess(false); setReview(null);
    try { setReview({ ...await loadTicketEmail(auth, item.registrationId), requestId: crypto.randomUUID() }); }
    catch { setError('The current ticket could not be loaded. Please try again.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function resend() {
    if (inFlight.current || !review) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await resendTicketEmail(auth, review.registrationId, review.requestId);
      if (result.outcome === 'SENT') { setSuccess(true); setReview(null); }
      else setError(result.outcome === 'IN_PROGRESS' ? 'A ticket email resend is already processing. Please wait and try again.' : 'Ticket email could not be sent. Please try again.');
    } catch { setError('Ticket email could not be sent. Please try again.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="admin-stack">
    <section className="admin-panel"><div className="panel-heading"><h2>Ticket Email Resender</h2><span>ADMIN only</span></div>
      <ParticipantSearch search={search} setSearch={setSearch} matches={matches} busy={busy} onSelect={select} action="RESEND EMAIL" showEmail />
    </section>
    {error && <div className="admin-page-message" role="alert">{error}</div>}
    {success && <div className="admin-notice" role="status">✓ Ticket email resent successfully.</div>}
    {review && <section className="admin-panel"><div className="ticket-edit-review" aria-labelledby="resend-heading">
      <h3 id="resend-heading">RESEND TICKET EMAIL</h3>
      <p>Participant: <strong>{review.fullName}</strong></p><p>Email: <strong>{review.email}</strong></p>
      <p>Ticket: <strong>{review.registrationId} · {review.ticketId}</strong></p>
      <p>Send the existing ticket email again?</p>
      <button type="button" className="secondary-button" onClick={() => setReview(null)} disabled={busy}>CANCEL</button>{' '}
      <button type="button" onClick={resend} disabled={busy}>{busy ? 'Sending…' : 'RESEND EMAIL'}</button>
    </div></section>}
  </div>;
}
