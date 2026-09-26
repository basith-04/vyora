import React, { useMemo, useRef, useState } from 'react';
import { loadTicketTransfer, submitTicketTransfer } from './adminApi.js';
import { defaultFilters, filterRegistrations } from './adminData.js';
import { buildRegistrationSubmission, updateRegistrationField, validateRegistration } from './registrationValidation.js';
import { departmentClasses, hostels, workshops, years } from './registrationOptions.js';
import './manual-ticket.css';

const fields = [
  ['Full name', 'fullName'], ['Email', 'email'], ['Phone', 'phone'], ['Year', 'year'],
  ['Department', 'department'], ['Class', 'class'], ['IEEE member', 'ieeeMember'],
  ['IEEE membership ID', 'ieeeMembershipId'], ['Workshop', 'workshopId'],
  ['Hosteller', 'isHosteller'], ['Hostel', 'hostel'], ['Needs stay', 'needsStay'], ['Stay type', 'stayType'],
];
const yesNo = (value) => value === true ? 'Yes' : value === false ? 'No' : '—';
const shown = (value) => typeof value === 'boolean' ? yesNo(value) : value ?? '—';

function amountPaise(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [rupees, fraction = ''] = value.trim().split('.');
  const amount = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function DetailList({ participant }) {
  return <dl className="manual-review">{fields.filter(([, key]) => (
    key !== 'ieeeMembershipId' || participant.ieeeMember
  ) && (key !== 'hostel' || participant.isHosteller) && (key !== 'needsStay' || !participant.isHosteller)
    && (key !== 'stayType' || (!participant.isHosteller && participant.needsStay)))
    .map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{shown(participant[key])}</dd></div>)}</dl>;
}

export default function TransferTicketView({ auth, registrations, onChanged }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const inFlight = useRef(false);
  const matches = useMemo(() => search.trim() ? filterRegistrations(registrations, search, defaultFilters)
    .filter((item) => item.registrationStatus === 'CONFIRMED' && item.paymentStatus === 'PAID')
    .sort((a, b) => Number(b.fullName.toLowerCase().includes(search.trim().toLowerCase()))
      - Number(a.fullName.toLowerCase().includes(search.trim().toLowerCase()))) : [], [registrations, search]);

  const open = async (id) => {
    setBusy(true); setError(''); setResult(null);
    try {
      const detail = await loadTicketTransfer(auth, id);
      setSelected(detail); setForm({ ...detail.participant }); setReview(null); setErrors({}); setAmount(''); setReason('');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const update = (field, value) => { setForm((previous) => updateRegistrationField(previous, field, value)); setErrors({}); };
  const prepare = (event) => {
    event.preventDefault();
    const next = validateRegistration(form);
    const paymentEntered = Boolean(amount.trim() || reason.trim());
    const parsed = paymentEntered ? amountPaise(amount) : null;
    if (paymentEntered && (!parsed || !reason.trim() || reason.trim().length > 200)) {
      next.manualPayment = 'Enter a positive INR amount and a reason (up to 200 characters).';
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    setError('');
    setReview({ requestId: crypto.randomUUID(), expectedUpdatedAt: selected.updatedAt,
      participant: buildRegistrationSubmission(form),
      ...(paymentEntered ? { manualPayment: { amountPaise: parsed, reason: reason.trim() } } : {}),
    });
  };
  const confirm = async () => {
    if (inFlight.current || !review) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const transferred = await submitTicketTransfer(auth, selected.registrationId, review);
      setResult(transferred); setSelected(transferred); setForm({ ...transferred.participant }); setReview(null);
      try { await onChanged(); } catch { /* The committed transfer remains visible in the result. */ }
    } catch (failure) { setError(failure.message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const fieldError = (field) => errors[field] && <small className="manual-field-error">{errors[field]}</small>;
  return <div className="admin-stack">
    <section className="admin-panel"><div className="panel-heading"><h2>Transfer Ticket</h2><span>ADMIN only</span></div>
      <div className="admin-search"><label>Search participant by name<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Participant name" /></label></div>
      {search.trim() && <div className="summary-list">{matches.length ? matches.map((item) => <button type="button" key={item.registrationId} onClick={() => open(item.registrationId)} disabled={busy}><span><strong>{item.fullName}</strong><small>{item.registrationId} · {item.email} · {item.phone} · Year {item.year} · {item.department || '—'} {item.class || ''}</small></span><span>TRANSFER</span></button>) : <div className="admin-empty">No confirmed participants found.</div>}</div>}
    </section>
    {error && <div className="admin-error" role="alert">{error}</div>}
    {result && <section className="admin-panel" role="status"><h2>Ticket transferred</h2><p>{result.registrationId} · {result.ticketId} · {result.participant.fullName}</p><p>New ticket email: {result.emailOutcome}</p></section>}
    {selected && !result && <section className="admin-panel manual-ticket-panel"><div className="panel-heading"><h2>{selected.registrationId}</h2><span>Ticket {selected.ticketId}</span></div>
      {review ? <div><h3>Review before transfer</h3><h4>Current holder</h4><DetailList participant={selected.participant} /><h4>New holder</h4><DetailList participant={review.participant} /><h4>Manual payment / adjustment</h4><p>{review.manualPayment ? `₹${(review.manualPayment.amountPaise / 100).toFixed(2)} · ${review.manualPayment.reason}` : 'None'}</p><div className="manual-actions"><button type="button" className="secondary-button" onClick={() => setReview(null)} disabled={busy}>Edit details</button><button type="button" onClick={confirm} disabled={busy}>{busy ? 'TRANSFERRING…' : 'CONFIRM TRANSFER'}</button></div></div>
        : <><h3>Current holder</h3><DetailList participant={selected.participant} /><h3>New participant</h3><form className="manual-ticket-form" onSubmit={prepare} noValidate>
          <label>Full name<input value={form.fullName} onChange={(event) => update('fullName', event.target.value)} />{fieldError('fullName')}</label>
          <label>Email<input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} />{fieldError('email')}</label>
          <label>Phone<input type="tel" value={form.phone} onChange={(event) => update('phone', event.target.value)} />{fieldError('phone')}</label>
          <label>Year<select value={form.year} onChange={(event) => update('year', Number(event.target.value) || '')}><option value="">Select year</option>{years.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>{fieldError('year')}</label>
          <label>Department<select value={form.department} onChange={(event) => update('department', event.target.value)}><option value="">Select department</option>{Object.keys(departmentClasses).map((item) => <option key={item}>{item}</option>)}</select>{fieldError('department')}</label>
          <label>Class<select value={form.class} disabled={!form.department} onChange={(event) => update('class', event.target.value)}><option value="">Select class</option>{(departmentClasses[form.department] || []).map((item) => <option key={item}>{item}</option>)}</select>{fieldError('class')}</label>
          <label>IEEE member<select value={form.ieeeMember === null ? '' : String(form.ieeeMember)} onChange={(event) => update('ieeeMember', event.target.value === '' ? null : event.target.value === 'true')}><option value="">Select</option><option value="true">Yes</option><option value="false">No</option></select>{fieldError('ieeeMember')}</label>
          {form.ieeeMember && <label>IEEE membership ID<input value={form.ieeeMembershipId || ''} onChange={(event) => update('ieeeMembershipId', event.target.value)} />{fieldError('ieeeMembershipId')}</label>}
          <label>Workshop<select value={form.workshopId} onChange={(event) => update('workshopId', event.target.value)}>{workshops.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>{fieldError('workshopId')}</label>
          <label>Hosteller<select value={form.isHosteller === null ? '' : String(form.isHosteller)} onChange={(event) => update('isHosteller', event.target.value === '' ? null : event.target.value === 'true')}><option value="">Select</option><option value="true">Yes</option><option value="false">No</option></select>{fieldError('isHosteller')}</label>
          {form.isHosteller ? <label>Hostel<select value={form.hostel || ''} onChange={(event) => update('hostel', event.target.value || null)}><option value="">Select hostel</option>{hostels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>{fieldError('hostel')}</label>
            : <><label>Needs stay<select value={form.needsStay === null ? '' : String(form.needsStay)} onChange={(event) => update('needsStay', event.target.value === '' ? null : event.target.value === 'true')}><option value="">Select</option><option value="true">Yes</option><option value="false">No</option></select>{fieldError('needsStay')}</label>{form.needsStay && <label>Stay type<select value={form.stayType || ''} onChange={(event) => update('stayType', event.target.value || null)}><option value="">Select stay type</option><option value="AC">AC</option><option value="NON_AC">Non-AC</option></select>{fieldError('stayType')}</label>}</>}
          <h3>Manual payment / adjustment (optional)</h3><p>Enter only money already collected outside Razorpay. The original payment and price stay unchanged.</p>
          <label>Amount (₹)<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>Note / Reason<input value={reason} maxLength="200" onChange={(event) => setReason(event.target.value)} /></label>{fieldError('manualPayment')}
          <div className="manual-actions"><button type="submit">REVIEW TRANSFER</button></div>
        </form></>}
      <h3>Manual payment history</h3>{selected.manualPayments.length ? <div className="ticket-list">{selected.manualPayments.map((payment, index) => <div className="ticket-row" key={`${payment.collectedAt}-${index}`}>₹{(payment.amountPaise / 100).toFixed(2)} · {payment.reason} · {payment.collectedAt || '—'} · {payment.recordedBy}</div>)}</div> : <p>No manual payments recorded.</p>}
    </section>}
  </div>;
}
