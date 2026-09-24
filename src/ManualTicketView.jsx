import React, { useRef, useState } from 'react';
import { createManualTicket } from './adminApi.js';
import { buildRegistrationSubmission, initialRegistration, updateRegistrationField, validateRegistration } from './registrationValidation.js';
import { departmentClasses, hostels, workshops, years } from './registrationOptions.js';
import './manual-ticket.css';

const yesNo = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }];

function Choice({ label, value, onChange, options, error }) {
  return <label>{label}<select value={value === null ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'true')}>
    <option value="">Select</option>{options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
  </select>{error && <small className="manual-field-error">{error}</small>}</label>;
}

export default function ManualTicketView({ auth, onChanged, onOpenRegistration, onOpenTickets }) {
  const [form, setForm] = useState({ ...initialRegistration });
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState('form');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const submissionKey = useRef(crypto.randomUUID());
  const update = (field, value) => { setForm((previous) => updateRegistrationField(previous, field, value)); setErrors({}); };
  const fieldError = (field) => errors[field] && <small className="manual-field-error">{errors[field]}</small>;
  const validAmount = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  const review = (event) => {
    event.preventDefault();
    const next = validateRegistration(form);
    if (!validAmount) next.manualAmount = 'Enter a positive INR amount with at most two decimal places.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setError(''); setPhase('review');
  };
  const create = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const created = await createManualTicket(auth, {
        participant: buildRegistrationSubmission(form), manualAmount: amount.trim(),
        idempotencyKey: submissionKey.current,
      });
      setResult(created); setPhase('success');
      try { await onChanged(); } catch { /* The created ticket remains available in the result. */ }
    } catch (failure) {
      setError(failure.message);
    } finally { inFlight.current = false; setBusy(false); }
  };

  if (phase === 'success') return <section className="admin-panel manual-ticket-panel"><h2>Manual ticket created</h2>
    <dl className="manual-review"><div><dt>Participant</dt><dd>{result.fullName}</dd></div><div><dt>Registration ID</dt><dd>{result.registrationId}</dd></div><div><dt>Ticket ID</dt><dd>{result.ticketId}</dd></div><div><dt>Manual amount collected</dt><dd>₹{(result.manualAmountPaise / 100).toFixed(2)}</dd></div><div><dt>Email delivery</dt><dd>{result.confirmationEmailStatus}</dd></div></dl>
    <div className="manual-actions"><button type="button" onClick={() => onOpenRegistration(result.registrationId)}>VIEW REGISTRATION DETAILS</button><button type="button" className="secondary-button" onClick={onOpenTickets}>VIEW TICKETS</button></div>
  </section>;

  return <section className="admin-panel manual-ticket-panel"><div className="panel-heading"><div><h2>Manual Ticket</h2><span>ADMIN only · Record an outside payment and issue the normal VYORA ticket</span></div></div>
    {error && <div className="admin-error" role="alert">{error}</div>}
    {phase === 'review' ? <div><h3>Review before create</h3><dl className="manual-review">
      {[
        ['Full name', form.fullName], ['Email', form.email], ['Phone', form.phone],
        ['Year', `Year ${form.year}`], ['Department', form.department], ['Class', form.class],
        ['IEEE member', form.ieeeMember ? 'Yes' : 'No'],
        ...(form.ieeeMember ? [['IEEE membership ID', form.ieeeMembershipId]] : []),
        ['Workshop', workshops.find((item) => item.id === form.workshopId)?.title],
        ['Hosteller', form.isHosteller ? 'Yes' : 'No'],
        ...(form.isHosteller ? [['Hostel', hostels.find((item) => item.id === form.hostel)?.label]] : [
          ['Needs stay', form.needsStay ? 'Yes' : 'No'],
          ...(form.needsStay ? [['Stay type', form.stayType?.replace('_', '-')]] : []),
        ]),
        ['Manual amount collected', `₹${Number(amount).toFixed(2)}`],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl><div className="manual-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setPhase('form')}>EDIT DETAILS</button><button type="button" disabled={busy} onClick={create}>{busy ? 'CREATING…' : 'CREATE MANUAL TICKET'}</button></div></div> :
    <form className="manual-ticket-form" onSubmit={review} noValidate>
      <label>Full name<input value={form.fullName} onChange={(event) => update('fullName', event.target.value)} />{fieldError('fullName')}</label>
      <label>Email<input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} />{fieldError('email')}</label>
      <label>10-digit phone<input type="tel" value={form.phone} onChange={(event) => update('phone', event.target.value)} />{fieldError('phone')}</label>
      <label>Year<select value={form.year} onChange={(event) => update('year', Number(event.target.value) || '')}><option value="">Select year</option>{years.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>{fieldError('year')}</label>
      <label>Department<select value={form.department} onChange={(event) => update('department', event.target.value)}><option value="">Select department</option>{Object.keys(departmentClasses).map((item) => <option key={item}>{item}</option>)}</select>{fieldError('department')}</label>
      <label>Class<select value={form.class} disabled={!form.department} onChange={(event) => update('class', event.target.value)}><option value="">Select class</option>{(departmentClasses[form.department] || []).map((item) => <option key={item}>{item}</option>)}</select>{fieldError('class')}</label>
      <Choice label="IEEE member" value={form.ieeeMember} onChange={(value) => update('ieeeMember', value)} options={yesNo} error={errors.ieeeMember} />
      {form.ieeeMember === true && <label>IEEE membership ID<input value={form.ieeeMembershipId || ''} onChange={(event) => update('ieeeMembershipId', event.target.value)} />{fieldError('ieeeMembershipId')}</label>}
      <label>Workshop<select value={form.workshopId} onChange={(event) => update('workshopId', event.target.value)}><option value="">Select workshop</option>{workshops.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>{fieldError('workshopId')}</label>
      <Choice label="Hosteller" value={form.isHosteller} onChange={(value) => update('isHosteller', value)} options={yesNo} error={errors.isHosteller} />
      {form.isHosteller === true && <label>Hostel<select value={form.hostel || ''} onChange={(event) => update('hostel', event.target.value || null)}><option value="">Select hostel</option>{hostels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>{fieldError('hostel')}</label>}
      {form.isHosteller === false && <Choice label="Needs stay" value={form.needsStay} onChange={(value) => update('needsStay', value)} options={yesNo} error={errors.needsStay} />}
      {form.isHosteller === false && form.needsStay === true && <label>Stay type<select value={form.stayType || ''} onChange={(event) => update('stayType', event.target.value || null)}><option value="">Select stay type</option><option value="AC">AC</option><option value="NON_AC">Non-AC</option></select>{fieldError('stayType')}</label>}
      <label>Manual amount collected (₹)<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />{fieldError('manualAmount')}</label>
      <div className="manual-actions"><button type="submit">REVIEW MANUAL TICKET</button></div>
    </form>}
  </section>;
}
