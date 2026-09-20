import React, { useEffect, useRef, useState } from 'react';
import { hostels, workshops, years } from './registrationOptions.js';
import {
  buildRegistrationSubmission,
  calculateFees,
  initialRegistration,
  normalizePhone,
  updateRegistrationField,
  validateRegistration,
} from './registrationValidation.js';
import { createRecoveryToken, registrationApi } from './registrationApi.js';
import { openRazorpayCheckout } from './razorpayCheckout.js';
import {
  canRetryPayment,
  FLOW_PHASE,
  isBusyPhase,
  phaseForApiError,
} from './registrationFlow.js';
import './registration.css';
import ParticipantTicket from './ParticipantTicket.jsx';

const steps = [
  { number: '01', label: 'DETAILS' },
  { number: '02', label: 'IEEE' },
  { number: '03', label: 'WORKSHOP' },
  { number: '04', label: 'FEES' },
  { number: '05', label: 'REVIEW' },
];

const formatFee = (fee) => fee === null ? '—' : `₹${fee}`;

function SectionHeading({ number, title, copy }) {
  const ids = { '01': 'details-heading', '02': 'ieee-heading', '03': 'workshop-heading', '04': 'fees-heading', '05': 'review-heading' };
  return <div className="registration-section-heading"><span className="registration-section-index">{number} /</span><div><h2 id={ids[number]}>{title}</h2><p>{copy}</p></div></div>;
}

function FieldError({ id, error }) {
  return error ? <p className="registration-error" id={id} role="alert"><span aria-hidden="true">!</span> {error}</p> : null;
}

function Progress({ current, complete }) {
  return <ol className="registration-progress" aria-label="Registration progress">{steps.map((step, index) => {
    const state = complete[index] ? 'done' : index === current ? 'current' : 'upcoming';
    return <li key={step.number} className={`registration-progress-${state}`} aria-current={state === 'current' ? 'step' : undefined}><span className="registration-progress-number">{state === 'done' ? '✓' : step.number}</span><span>{step.label}</span></li>;
  })}</ol>;
}

function TextField({ field, label, placeholder, type = 'text', value, onChange, onBlur, error, inputRef, autoComplete, inputMode, prefix }) {
  const errorId = `${field}-error`;
  return <div className="registration-field"><label htmlFor={field}>{label} <span aria-hidden="true">*</span></label><div className={`registration-input-wrap${prefix ? ' has-prefix' : ''}`}>{prefix && <span className="registration-input-prefix" aria-hidden="true">{prefix}</span>}<input ref={inputRef} id={field} name={field} type={type} placeholder={placeholder} value={value ?? ''} onChange={onChange} onBlur={onBlur} autoComplete={autoComplete} inputMode={inputMode} required aria-invalid={!!error} aria-describedby={error ? errorId : undefined} /></div><FieldError id={errorId} error={error} /></div>;
}

function RegistrationHero() {
  return <div className="registration-hero"><span className="registration-exe">// REGISTRATION.EXE<br />PARTICIPANT INITIALIZATION</span><h1>INITIALIZE<br /><span>YOUR ENTRY.</span></h1><p>COMPLETE YOUR DETAILS.<br />CHOOSE YOUR AIDEX PATH.<br />REVIEW YOUR FEE.</p><span className="registration-hero-mark" aria-hidden="true">+</span></div>;
}

function YesNoChoice({ field, legend, value, onChange, onBlur, error, inputRef }) {
  return <fieldset className="registration-choice-fieldset"><legend>{legend} <span aria-hidden="true">*</span></legend><div className="registration-ieee-grid">{[{ label: 'YES', value: true }, { label: 'NO', value: false }].map((option, index) => <label className={`registration-ieee-option registration-accommodation-option${value === option.value ? ' is-selected' : ''}`} key={option.label}><input ref={index === 0 ? inputRef : undefined} type="radio" name={field} required value={option.label} checked={value === option.value} onChange={() => onChange(field, option.value)} onBlur={() => onBlur(field)} aria-invalid={!!error} aria-describedby={error ? `${field}-error` : undefined} /><span className="registration-radio-mark" aria-hidden="true" /><strong>{option.label}</strong></label>)}</div><FieldError id={`${field}-error`} error={error} /></fieldset>;
}

function AccommodationFields({ form, update, blur, errorFor, refs }) {
  return <div className="registration-accommodation">
    <YesNoChoice field="isHosteller" legend="HOSTELLER?" value={form.isHosteller} onChange={update} onBlur={blur} error={errorFor('isHosteller')} inputRef={refs.isHosteller} />
    {form.isHosteller === true && <div className="registration-field registration-hostel-field"><label htmlFor="hostel">SELECT HOSTEL <span aria-hidden="true">*</span></label><div className="registration-input-wrap registration-select-wrap"><select ref={refs.hostel} id="hostel" name="hostel" required value={form.hostel ?? ''} onChange={(event) => update('hostel', event.target.value)} onBlur={() => blur('hostel')} aria-invalid={!!errorFor('hostel')} aria-describedby={errorFor('hostel') ? 'hostel-error' : undefined}><option value="">Select hostel</option>{hostels.map((hostel) => <option key={hostel.id} value={hostel.id}>{hostel.label}</option>)}</select></div><FieldError id="hostel-error" error={errorFor('hostel')} /></div>}
    {form.isHosteller === false && <YesNoChoice field="needsStay" legend="NEED STAY?" value={form.needsStay} onChange={update} onBlur={blur} error={errorFor('needsStay')} inputRef={refs.needsStay} />}
    {form.isHosteller === false && form.needsStay === true && <div className="registration-field"><label htmlFor="stayType">STAY TYPE <span aria-hidden="true">*</span></label><div className="registration-input-wrap registration-select-wrap"><select ref={refs.stayType} id="stayType" name="stayType" required value={form.stayType ?? ''} onChange={(event) => update('stayType', event.target.value)} onBlur={() => blur('stayType')} aria-invalid={!!errorFor('stayType')} aria-describedby={errorFor('stayType') ? 'stayType-error' : undefined}><option value="">Select stay type</option><option value="NON_AC">NON-AC — ₹250</option><option value="AC">AC — ₹300</option></select></div><FieldError id="stayType-error" error={errorFor('stayType')} /></div>}
  </div>;
}

function ParticipantSection({ form, update, blur, errorFor, refs }) {
  return <section className="registration-section" id="registration-details" aria-labelledby="details-heading"><SectionHeading number="01" title="PARTICIPANT DETAILS" copy="TELL US ABOUT YOURSELF." /><div className="registration-fields"><TextField field="fullName" label="FULL NAME" placeholder="Enter your full name" value={form.fullName} onChange={(event) => update('fullName', event.target.value)} onBlur={() => blur('fullName')} error={errorFor('fullName')} inputRef={refs.fullName} autoComplete="name" /><TextField field="email" label="EMAIL ADDRESS" placeholder="you@example.com" type="email" value={form.email} onChange={(event) => update('email', event.target.value)} onBlur={() => blur('email')} error={errorFor('email')} inputRef={refs.email} autoComplete="email" /><TextField field="phone" label="PHONE NUMBER" placeholder="10-digit mobile number" type="tel" value={form.phone} onChange={(event) => update('phone', normalizePhone(event.target.value))} onBlur={() => blur('phone')} error={errorFor('phone')} inputRef={refs.phone} autoComplete="tel" inputMode="numeric" prefix="+91" /></div><fieldset className="registration-choice-fieldset"><legend>YEAR OF STUDY <span aria-hidden="true">*</span></legend><div className="registration-year-grid">{years.map((year, index) => <label className={`registration-year-option${form.year === year.id ? ' is-selected' : ''}`} key={year.id}><input ref={index === 0 ? refs.year : undefined} type="radio" name="year" required value={year.id} checked={form.year === year.id} onChange={() => update('year', year.id)} onBlur={() => blur('year')} aria-describedby={errorFor('year') ? 'year-error' : undefined} /><span className="registration-radio-mark" aria-hidden="true" /><span className="registration-choice-number">{year.number}</span><span>{year.label}</span></label>)}</div><FieldError id="year-error" error={errorFor('year')} /></fieldset><AccommodationFields form={form} update={update} blur={blur} errorFor={errorFor} refs={refs} /></section>;
}

function IeeeSection({ form, update, blur, errorFor, refs, fee }) {
  return <section className="registration-section" id="registration-ieee" aria-labelledby="ieee-heading"><SectionHeading number="02" title="IEEE MEMBERSHIP" copy="ARE YOU AN IEEE MEMBER?" /><fieldset className="registration-choice-fieldset"><legend className="registration-sr-only">IEEE membership status</legend><div className="registration-ieee-grid">{[{ value: true, title: 'YES', subtitle: 'IEEE MEMBER' }, { value: false, title: 'NO', subtitle: 'NON-IEEE' }].map((option, index) => <label className={`registration-ieee-option${form.ieeeMember === option.value ? ' is-selected' : ''}`} key={option.title}><input ref={index === 0 ? refs.ieeeMember : undefined} type="radio" name="ieeeMember" required value={option.title} checked={form.ieeeMember === option.value} onChange={() => update('ieeeMember', option.value)} onBlur={() => blur('ieeeMember')} aria-describedby={errorFor('ieeeMember') ? 'ieeeMember-error' : undefined} /><span className="registration-radio-mark" aria-hidden="true" /><strong>{option.title}</strong><span>{option.subtitle}</span></label>)}</div><FieldError id="ieeeMember-error" error={errorFor('ieeeMember')} /></fieldset>{form.ieeeMember === true && <TextField field="ieeeMembershipId" label="IEEE MEMBERSHIP ID" placeholder="Enter your IEEE membership ID" value={form.ieeeMembershipId} onChange={(event) => update('ieeeMembershipId', event.target.value)} onBlur={() => blur('ieeeMembershipId')} error={errorFor('ieeeMembershipId')} inputRef={refs.ieeeMembershipId} autoComplete="off" />}<div className={`registration-fee-display${fee === null ? ' is-empty' : ''}`}><div><span>REGISTRATION FEE</span><strong>{fee === null ? 'SELECT IEEE STATUS' : formatFee(fee)}</strong></div><span>{fee === null ? 'TO DETERMINE REGISTRATION FEE' : form.ieeeMember ? 'IEEE MEMBER' : 'NON-IEEE'}</span></div></section>;
}

function WorkshopSection({ form, update, blur, errorFor, refs }) {
  return <section className="registration-section" id="registration-workshop" aria-labelledby="workshop-heading"><SectionHeading number="03" title="CHOOSE YOUR AIDEX PATH" copy="SELECT ONE WORKSHOP." /><p className="registration-free-access"><span className="registration-status-dot" aria-hidden="true" /> WORKSHOP ACCESS: FREE <span>/</span> NO ADDITIONAL FEE</p><fieldset className="registration-choice-fieldset"><legend className="registration-sr-only">AIDEX workshop</legend><div className="registration-workshop-grid">{workshops.map((workshop, index) => <label className={`registration-workshop-option registration-accent-${workshop.accent}${form.workshopId === workshop.id ? ' is-selected' : ''}`} key={workshop.id}><input ref={index === 0 ? refs.workshopId : undefined} type="radio" name="workshopId" required value={workshop.id} checked={form.workshopId === workshop.id} onChange={() => update('workshopId', workshop.id)} onBlur={() => blur('workshopId')} aria-describedby={errorFor('workshopId') ? 'workshopId-error' : undefined} /><span className="registration-workshop-bar">AIDEX / {workshop.number}<span aria-hidden="true">− □ ×</span></span><span className="registration-workshop-body"><strong>{workshop.title}</strong><span className="registration-workshop-select"><span className="registration-radio-mark" aria-hidden="true" />{form.workshopId === workshop.id ? 'SELECTED' : 'SELECT PATH'}</span></span></label>)}</div><FieldError id="workshopId-error" error={errorFor('workshopId')} /></fieldset></section>;
}

function FeesSection({ form, fees }) {
  const prompt = fees.baseFee === null ? 'SELECT IEEE STATUS FIRST' : fees.totalFee === null ? 'COMPLETE ACCOMMODATION DETAILS' : form.ieeeMember ? 'IEEE MEMBER' : 'NON-IEEE';
  return <section className="registration-section" id="registration-fees" aria-labelledby="fees-heading"><SectionHeading number="04" title="FEE SUMMARY" copy="YOUR FINAL PRICE WILL BE CALCULATED BY THE SERVER." /><div className="registration-payment-grid"><div className="registration-pay-amount"><span>ESTIMATED TOTAL</span><strong>{formatFee(fees.totalFee)}</strong><small>{prompt}</small>{fees.totalFee !== null && <dl className="registration-pay-breakdown"><div><dt>REGISTRATION</dt><dd>{formatFee(fees.baseFee)}</dd></div><div><dt>STAY</dt><dd>{formatFee(fees.stayFee)}</dd></div><div className="registration-pay-total"><dt>TOTAL</dt><dd>{formatFee(fees.totalFee)}</dd></div></dl>}</div></div><p className="registration-payment-note">THE SERVER WILL RESERVE YOUR SEAT FOR FIVE MINUTES AND OPEN SECURE RAZORPAY CHECKOUT.</p></section>;
}

function ReviewRow({ label, value }) {
  return <div className="registration-review-row"><dt>{label}</dt><dd className={!value ? 'is-missing' : undefined}>{value || '— NOT PROVIDED'}</dd></div>;
}

function ReviewSection({ form, fees, workshop, year, onEdit, loading }) {
  const hostel = hostels.find((item) => item.id === form.hostel);
  return <section className="registration-section registration-review-section" id="registration-review" aria-labelledby="review-heading"><SectionHeading number="05" title="REVIEW" copy="CHECK YOUR DETAILS BEFORE CONTINUING." /><div className="registration-review-window"><div className="registration-review-bar"><span>PARTICIPANT DATA / REVIEW</span><span aria-hidden="true">− □ ×</span></div><dl><ReviewRow label="FULL NAME" value={form.fullName.trim()} /><ReviewRow label="EMAIL" value={form.email.trim()} /><ReviewRow label="PHONE" value={form.phone ? `+91 ${normalizePhone(form.phone)}` : ''} /><ReviewRow label="YEAR" value={year?.label} /><ReviewRow label="HOSTELLER" value={form.isHosteller === null ? '' : form.isHosteller ? 'YES' : 'NO'} />{form.isHosteller === true && <ReviewRow label="HOSTEL" value={hostel?.label} />}{form.isHosteller === false && <ReviewRow label="NEED STAY" value={form.needsStay === null ? '' : form.needsStay ? 'YES' : 'NO'} />}{form.needsStay === true && <ReviewRow label="STAY TYPE" value={form.stayType?.replace('_', '-')} />}<ReviewRow label="IEEE STATUS" value={form.ieeeMember === null ? '' : form.ieeeMember ? 'IEEE MEMBER' : 'NON-IEEE'} />{form.ieeeMember === true && <ReviewRow label="IEEE MEMBERSHIP ID" value={form.ieeeMembershipId.trim()} />}<ReviewRow label="AIDEX WORKSHOP" value={workshop?.title} /><ReviewRow label="ESTIMATED TOTAL" value={fees.totalFee === null ? '' : formatFee(fees.totalFee)} /></dl><div className="registration-review-edit"><button type="button" onClick={() => onEdit('registration-details', 'fullName')}>EDIT DETAILS ↗</button><button type="button" onClick={() => onEdit('registration-ieee', 'ieeeMember')}>REVIEW FEES ↗</button></div></div><button className="registration-submit" type="submit" disabled={loading}>{loading ? 'RESERVING SEAT...' : 'RESERVE & PAY'} <span aria-hidden="true">→</span></button><p className="registration-submit-note">YOUR SEAT IS RESERVED ONLY AFTER THE SERVER ACCEPTS THIS FORM.</p></section>;
}

function RegistrationStatus({ fees, workshop, completion }) {
  return <aside className="registration-sidebar" aria-label="Registration status"><div className="registration-sidebar-bar">// REGISTRATION STATUS <span aria-hidden="true">□ ×</span></div><div className="registration-sidebar-body"><span>ESTIMATED FEE</span><strong>{formatFee(fees.totalFee)}</strong><small>{fees.totalFee === null ? 'COMPLETE REQUIRED DETAILS' : 'SERVER WILL VERIFY'}</small><span>AIDEX PATH</span><b>{workshop?.title || 'NOT SELECTED'}</b><span>PAYMENT</span><b>NOT STARTED</b><span>COMPLETION</span><b>{completion} / 5</b></div></aside>;
}

const stateCopy = {
  [FLOW_PHASE.reserving]: ['RESERVING SEAT...', 'The server is validating your details and reserving capacity.'],
  [FLOW_PHASE.paymentPending]: ['PAYMENT PENDING', 'Your seat is reserved. Complete payment before the timer expires.'],
  [FLOW_PHASE.paymentFailed]: ['PAYMENT FAILED', 'No confirmation was created. You can retry the same order while your reservation is active.'],
  [FLOW_PHASE.verifying]: ['VERIFYING PAYMENT...', 'Payment was returned by Checkout. Waiting for trusted backend verification.'],
  [FLOW_PHASE.verificationFailed]: ['PAYMENT VERIFICATION FAILED', 'The payment could not be confirmed automatically. Retry status recovery or contact the organizers if you were charged.'],
  [FLOW_PHASE.networkError]: ['NETWORK ERROR', 'The result could not be retrieved. Your reservation and payment state remain on the server.'],
  [FLOW_PHASE.expired]: ['RESERVATION EXPIRED', 'This seat was released. Begin a fresh registration attempt before paying again.'],
  [FLOW_PHASE.reconciliation]: ['PAYMENT REQUIRES RECONCILIATION', 'Payment was received after the reservation could be confirmed. The organizers must review it; no extra seat was created.'],
  [FLOW_PHASE.confirmed]: ['REGISTRATION CONFIRMED', 'Your payment was verified by the backend and your reserved seat is confirmed.'],
};

function formatCountdown(seconds) {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function PaymentState({ phase, reservation, remainingSeconds, message, onRetry, onFresh, ticket, ticketLoading, ticketError, onTicketRetry }) {
  const [title, copy] = stateCopy[phase] ?? ['REGISTRATION ERROR', message || 'The request could not be completed.'];
  const confirmed = phase === FLOW_PHASE.confirmed;
  return <div className={`registration-terminal registration-success registration-payment-state state-${phase}`} role="status" aria-live="polite"><span>// PAYMENT.EXE</span>{confirmed && <div className="registration-success-mark" aria-hidden="true">✓</div>}<h1>{title}</h1><p>{message || copy}</p>{reservation && <div className="registration-success-grid"><div><span>REGISTRATION</span><strong>{reservation.registrationId}</strong></div><div><span>SERVER STATUS</span><strong>{reservation.registrationStatus}</strong></div><div><span>AUTHORITATIVE TOTAL</span><strong>{formatFee(reservation.pricing?.totalFee)}</strong></div><div><span>{confirmed ? 'PAYMENT' : 'RESERVATION TIMER'}</span><strong className={confirmed ? '' : 'registration-pending'}>{confirmed ? 'PAID' : formatCountdown(remainingSeconds)}</strong></div></div>}{confirmed && <ParticipantTicket ticket={ticket} loading={ticketLoading} error={ticketError} onRetry={onTicketRetry} />}{canRetryPayment(phase, remainingSeconds) && <button className="registration-submit registration-retry" type="button" onClick={onRetry}>OPEN CHECKOUT AGAIN <span aria-hidden="true">→</span></button>}{phase === FLOW_PHASE.paymentFailed && !reservation && <button className="registration-submit registration-retry" type="button" onClick={onRetry}>TRY AGAIN <span aria-hidden="true">→</span></button>}{[FLOW_PHASE.expired, FLOW_PHASE.paymentFailed, FLOW_PHASE.networkError].includes(phase) && <button className="registration-secondary-action" type="button" onClick={onFresh}>START A FRESH ATTEMPT</button>}<div className="registration-success-actions"><a href="/">BACK TO HOME →</a></div></div>;
}

const SESSION_KEY = 'vyora26.registration.recovery';

export default function RegistrationPage() {
  const [form, setForm] = useState(initialRegistration);
  const [touched, setTouched] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState(FLOW_PHASE.form);
  const [reservation, setReservation] = useState(null);
  const [flowMessage, setFlowMessage] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [ticket, setTicket] = useState(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketError, setTicketError] = useState('');
  const recoveryToken = useRef(null);
  const submissionInFlight = useRef(false);
  const refs = {
    fullName: useRef(null), email: useRef(null), phone: useRef(null), year: useRef(null),
    isHosteller: useRef(null), hostel: useRef(null), needsStay: useRef(null), stayType: useRef(null),
    ieeeMember: useRef(null), ieeeMembershipId: useRef(null), workshopId: useRef(null),
  };
  const errors = validateRegistration(form);
  const fees = calculateFees(form);
  const workshop = workshops.find((item) => item.id === form.workshopId);
  const year = years.find((item) => item.id === form.year);
  const complete = [
    !errors.fullName && !errors.email && !errors.phone && !errors.year && !errors.isHosteller && !errors.hostel && !errors.needsStay && !errors.stayType,
    !errors.ieeeMember && !errors.ieeeMembershipId,
    !errors.workshopId,
    fees.totalFee !== null,
  ];
  const current = complete.findIndex((done) => !done) === -1 ? 4 : complete.findIndex((done) => !done);
  const completion = complete.filter(Boolean).length;
  const update = (field, value) => {
    setForm((previous) => updateRegistrationField(previous, field, value));
    if (field === 'isHosteller') setTouched((previous) => ({ ...previous, hostel: false, needsStay: false, stayType: false }));
    if (field === 'needsStay') setTouched((previous) => ({ ...previous, stayType: false }));
  };
  const blur = (field) => setTouched((previous) => ({ ...previous, [field]: true }));
  const errorFor = (field) => attempted || touched[field] ? errors[field] : '';
  const onEdit = (id, field) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); window.setTimeout(() => refs[field].current?.focus(), 250); };
  const saveRecovery = (registrationId, token) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ registrationId, token }));
  };
  const applyReservation = (data, token) => {
    setReservation(data);
    saveRecovery(data.registrationId, token);
    setRemainingSeconds(Math.max(0, Math.ceil((Date.parse(data.seatReservationExpiresAt) - Date.now()) / 1000)));
  };
  const loadTicket = async (registrationId, token) => {
    setTicketLoading(true);
    setTicketError('');
    try {
      setTicket(await registrationApi.ticket(registrationId, token));
    } catch (error) {
      setTicketError(error.message || 'The ticket could not be loaded.');
    } finally {
      setTicketLoading(false);
    }
  };
  const runCheckout = async (data, token) => {
    if (!data.checkout || Date.parse(data.seatReservationExpiresAt) <= Date.now()) {
      setPhase(FLOW_PHASE.expired);
      return;
    }
    setPhase(FLOW_PHASE.paymentPending);
    setFlowMessage('');
    let checkoutResult;
    try {
      checkoutResult = await openRazorpayCheckout(data.checkout);
    } catch (error) {
      setFlowMessage(error.message);
      setPhase(FLOW_PHASE.networkError);
      return;
    }
    if (checkoutResult.type === 'closed') {
      setFlowMessage('Checkout was closed. Your reservation remains active until the timer expires.');
      setPhase(FLOW_PHASE.paymentPending);
      return;
    }
    if (checkoutResult.type === 'failed') {
      setFlowMessage('Razorpay reported that this payment attempt failed. No registration was confirmed.');
      setPhase(FLOW_PHASE.paymentFailed);
      return;
    }
    setPhase(FLOW_PHASE.verifying);
    try {
      const verified = await registrationApi.verify({
        registrationId: data.registrationId,
        razorpayOrderId: checkoutResult.response.razorpay_order_id,
        razorpayPaymentId: checkoutResult.response.razorpay_payment_id,
        razorpaySignature: checkoutResult.response.razorpay_signature,
      }, token);
      setReservation((previous) => ({ ...previous, ...verified }));
      setPhase(FLOW_PHASE.confirmed);
      setFlowMessage('');
      await loadTicket(data.registrationId, token);
    } catch (error) {
      setFlowMessage(error.message);
      setPhase(phaseForApiError(error));
    }
  };
  const onSubmit = async (event) => {
    event.preventDefault();
    if (phase !== FLOW_PHASE.form || isBusyPhase(phase) || submissionInFlight.current) return;
    setAttempted(true);
    const firstError = Object.keys(errors)[0];
    if (firstError) {
      window.requestAnimationFrame(() => {
        refs[firstError].current?.focus();
        refs[firstError].current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    const token = recoveryToken.current ?? createRecoveryToken();
    recoveryToken.current = token;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token }));
    submissionInFlight.current = true;
    setPhase(FLOW_PHASE.reserving);
    setFlowMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const data = await registrationApi.create(buildRegistrationSubmission(form), token);
      applyReservation(data, token);
      await runCheckout(data, token);
    } catch (error) {
      setFlowMessage(error.message);
      setPhase(phaseForApiError(error));
    } finally {
      submissionInFlight.current = false;
    }
  };

  useEffect(() => {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { saved = null; }
    if (!saved?.token) return undefined;
    recoveryToken.current = saved.token;
    setPhase(FLOW_PHASE.reserving);
    registrationApi.status(saved.registrationId, saved.token).then((data) => {
      applyReservation(data, saved.token);
      if (data.registrationStatus === 'CONFIRMED') {
        setPhase(FLOW_PHASE.confirmed);
        loadTicket(data.registrationId, saved.token);
      } else if (data.registrationStatus === 'EXPIRED') {
        setPhase(FLOW_PHASE.expired);
      } else {
        setPhase(FLOW_PHASE.paymentPending);
      }
    }).catch((error) => {
      setFlowMessage(error.message);
      setPhase(phaseForApiError(error));
    });
    return undefined;
  }, []);

  useEffect(() => {
    if (!reservation?.seatReservationExpiresAt || phase === FLOW_PHASE.confirmed) return undefined;
    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(reservation.seatReservationExpiresAt) - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0 && ![FLOW_PHASE.confirmed, FLOW_PHASE.reconciliation, FLOW_PHASE.verifying].includes(phase)) {
        setPhase(FLOW_PHASE.expired);
      }
    };
    updateTimer();
    const timer = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(timer);
  }, [reservation?.seatReservationExpiresAt, phase]);

  const retry = async () => {
    if (isBusyPhase(phase) || submissionInFlight.current) return;
    const token = recoveryToken.current;
    if (!token) return;
    submissionInFlight.current = true;
    setPhase(FLOW_PHASE.reserving);
    setFlowMessage('');
    try {
      const data = reservation
        ? await registrationApi.retry(reservation.registrationId, token)
        : await registrationApi.create(buildRegistrationSubmission(form), token);
      applyReservation(data, token);
      await runCheckout(data, token);
    } catch (error) {
      setFlowMessage(error.message);
      setPhase(phaseForApiError(error));
    } finally {
      submissionInFlight.current = false;
    }
  };
  const freshAttempt = () => {
    sessionStorage.removeItem(SESSION_KEY);
    recoveryToken.current = null;
    setReservation(null);
    setTicket(null);
    setTicketError('');
    setFlowMessage('');
    setPhase(FLOW_PHASE.form);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return <main className="registration-page" id="main-content"><div className="registration-container">{phase !== FLOW_PHASE.form ? <PaymentState phase={phase} reservation={reservation} remainingSeconds={remainingSeconds} message={flowMessage} onRetry={retry} onFresh={freshAttempt} ticket={ticket} ticketLoading={ticketLoading} ticketError={ticketError} onTicketRetry={() => loadTicket(reservation.registrationId, recoveryToken.current)} /> : <><RegistrationHero /><Progress current={current} complete={complete} /><div className="registration-layout"><form className="registration-form" noValidate onSubmit={onSubmit}><ParticipantSection form={form} update={update} blur={blur} errorFor={errorFor} refs={refs} /><IeeeSection form={form} update={update} blur={blur} errorFor={errorFor} refs={refs} fee={fees.baseFee} /><WorkshopSection form={form} update={update} blur={blur} errorFor={errorFor} refs={refs} /><FeesSection form={form} fees={fees} /><ReviewSection form={form} fees={fees} workshop={workshop} year={year} onEdit={onEdit} loading={isBusyPhase(phase)} /></form><RegistrationStatus fees={fees} workshop={workshop} completion={completion} /></div></>}</div></main>;
}
