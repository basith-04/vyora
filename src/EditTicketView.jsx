import React, { useMemo, useState } from 'react';
import { loadTicketEdit, saveTicketEdit } from './adminApi.js';
import { defaultFilters, filterRegistrations, hostelLabels } from './adminData.js';

function accommodationOf(item) {
  return { isHosteller: item.isHosteller, hostel: item.hostel, needsStay: item.needsStay, stayType: item.stayType };
}

function accommodationLabel(value) {
  if (value.isHosteller) return `Hosteller · ${hostelLabels[value.hostel] || value.hostel}`;
  return value.needsStay ? `Event stay · ${value.stayType}` : 'No stay';
}

function parseRupees(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [rupees, paise = ''] = value.trim().split('.');
  const amount = Number(rupees) * 100 + Number(paise.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export default function EditTicketView({ auth, registrations, onChanged }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const matches = useMemo(() => search.trim()
    ? filterRegistrations(registrations, search, defaultFilters)
      .filter((item) => item.registrationStatus === 'CONFIRMED' && item.paymentStatus === 'PAID')
      .sort((a, b) => Number(b.fullName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
        - Number(a.fullName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
    : [], [registrations, search]);

  const open = async (id) => {
    setBusy(true); setError(''); setSaved(false);
    try {
      const item = await loadTicketEdit(auth, id);
      setSelected(item); setDraft(accommodationOf(item)); setReview(null); setAmount(''); setReason('');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const prepare = () => {
    setError('');
    if (draft.isHosteller && !draft.hostel) { setError('Choose the existing hostel.'); return; }
    const changed = Object.keys(draft).some((key) => draft[key] !== selected[key]);
    const hasPayment = amount.trim() || reason.trim();
    const amountPaise = hasPayment ? parseRupees(amount) : null;
    if (hasPayment && (!amountPaise || !reason.trim())) { setError('Enter a positive INR amount and a reason.'); return; }
    if (!changed && !hasPayment) { setError('Choose an accommodation change or enter a manual payment.'); return; }
    setReview({ requestId: crypto.randomUUID(), expectedUpdatedAt: selected.updatedAt,
      ...(changed ? { accommodation: draft } : {}),
      ...(hasPayment ? { manualPayment: { amountPaise, reason: reason.trim() } } : {}),
    });
  };
  const confirm = async () => {
    if (busy || !review) return;
    setBusy(true); setError('');
    try {
      await saveTicketEdit(auth, selected.registrationId, review);
      const stored = await loadTicketEdit(auth, selected.registrationId);
      setSelected(stored); setDraft(accommodationOf(stored)); setReview(null);
      setAmount(''); setReason(''); setSaved(true);
      await onChanged();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const updateMode = (mode) => {
    if (mode === 'hosteller') setDraft({ isHosteller: true, hostel: selected.hostel || '', needsStay: false, stayType: null });
    else if (mode === 'stay') setDraft({ isHosteller: false, hostel: null, needsStay: true, stayType: draft.stayType || 'NON_AC' });
    else setDraft({ isHosteller: false, hostel: null, needsStay: false, stayType: null });
  };

  return <div className="admin-stack">
    <section className="admin-panel"><div className="panel-heading"><h2>Edit Ticket</h2><span>ADMIN only</span></div>
      <div className="admin-search"><label>Search participant by name<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Participant name" /></label></div>
      {search.trim() && <div className="summary-list">{matches.length ? matches.map((item) => <button type="button" key={item.registrationId} onClick={() => open(item.registrationId)} disabled={busy}><span><strong>{item.fullName}</strong><small>{item.registrationId} · Year {item.year} · {item.department || '—'} {item.class || ''}</small></span><span>EDIT</span></button>) : <div className="admin-empty">No confirmed participants found.</div>}</div>}
    </section>
    {error && <div className="admin-page-message" role="alert">{error}</div>}
    {selected && <section className="admin-panel">
      <div className="panel-heading"><h2>{selected.fullName}</h2><span>{selected.registrationId} · {selected.ticketId} · Year {selected.year}</span></div>
      {saved && <div className="admin-notice" role="status">Saved. The values below were reloaded from the server.</div>}
      <p>Current accommodation: <strong>{accommodationLabel(selected)}</strong></p>
      <p>Original registration total: ₹{selected.originalTotalFee} · Razorpay payment: {selected.razorpayPaymentId || '—'}</p>
      <h3>Accommodation correction</h3>
      <div className="ticket-edit-fields">
        <label>Accommodation type<select value={draft.isHosteller ? 'hosteller' : draft.needsStay ? 'stay' : 'none'} onChange={(event) => updateMode(event.target.value)} disabled={Boolean(review)}><option value="hosteller">Existing hosteller</option><option value="stay">Event accommodation</option><option value="none">No stay</option></select></label>
        {draft.isHosteller && <label>Hostel<select value={draft.hostel} onChange={(event) => setDraft({ ...draft, hostel: event.target.value })} disabled={Boolean(review)}><option value="">Choose hostel</option>{Object.entries(hostelLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
        {draft.needsStay && <label>Stay type<select value={draft.stayType} onChange={(event) => setDraft({ ...draft, stayType: event.target.value })} disabled={Boolean(review)}><option value="NON_AC">NON_AC</option><option value="AC">AC</option></select></label>}
      </div>
      <h3>Add manual payment</h3><p>Enter only money already collected outside Razorpay. This does not change the original payment or price.</p>
      <div className="ticket-edit-fields"><label>Amount (₹)<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={Boolean(review)} /></label><label>Note / Reason<input value={reason} maxLength="200" onChange={(event) => setReason(event.target.value)} disabled={Boolean(review)} /></label></div>
      {!review && <button type="button" onClick={prepare}>{amount.trim() || reason.trim() ? 'ADD PAYMENT · REVIEW' : 'Review accommodation change'}</button>}
      {review && <div className="ticket-edit-review"><h3>Review before saving</h3><p>CURRENT: {accommodationLabel(selected)}</p><p>PROPOSED: {accommodationLabel(review.accommodation || selected)}</p><p>Manual payment: {review.manualPayment ? `₹${(review.manualPayment.amountPaise / 100).toFixed(2)} · ${review.manualPayment.reason}` : 'None'}</p><button type="button" onClick={confirm} disabled={busy}>{busy ? 'Saving…' : 'Confirm and save'}</button> <button type="button" className="secondary-button" onClick={() => setReview(null)} disabled={busy}>Back</button></div>}
      <h3>Manual payment history</h3>{selected.manualPayments.length ? <div className="ticket-list">{selected.manualPayments.map((payment, index) => <div className="ticket-row" key={`${payment.collectedAt}-${index}`}>₹{(payment.amountPaise / 100).toFixed(2)} · {payment.reason} · {payment.collectedAt || '—'} · {payment.recordedBy}</div>)}</div> : <p>No manual payments recorded.</p>}
    </section>}
  </div>;
}
