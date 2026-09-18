import React, { useEffect, useRef, useState } from 'react';
import { registrationConfig, workshops, years } from './registrationConfig.js';
import { initialRegistration, normalizePhone, paymentProofError, validateRegistration } from './registrationValidation.js';
import './registration.css';

const steps = [
  { number: '01', label: 'DETAILS' }, { number: '02', label: 'IEEE' },
  { number: '03', label: 'WORKSHOP' }, { number: '04', label: 'PAYMENT' },
  { number: '05', label: 'REVIEW' },
];

const formatFee = (fee) => fee === null ? '—' : `₹${fee}`;
const formatSize = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
// The Firebase phase will replace this with the server-issued registration ID.
const DEMO_REGISTRATION_ID = 'VYR-DEMO-001';

function SectionHeading({ number, title, copy }) {
  const ids = { '01': 'details-heading', '02': 'ieee-heading', '03': 'workshop-heading', '04': 'payment-heading', '05': 'review-heading' };
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
  return <div className="registration-field"><label htmlFor={field}>{label} <span aria-hidden="true">*</span></label><div className={`registration-input-wrap${prefix ? ' has-prefix' : ''}`}>{prefix && <span className="registration-input-prefix" aria-hidden="true">{prefix}</span>}<input ref={inputRef} id={field} name={field} type={type} placeholder={placeholder} value={value} onChange={onChange} onBlur={onBlur} autoComplete={autoComplete} inputMode={inputMode} required aria-invalid={!!error} aria-describedby={error ? errorId : undefined} /></div><FieldError id={errorId} error={error} /></div>;
}

function RegistrationHero() {
  return <div className="registration-hero"><span className="registration-exe">// REGISTRATION.EXE<br />PARTICIPANT INITIALIZATION</span><h1>INITIALIZE<br /><span>YOUR ENTRY.</span></h1><p>COMPLETE YOUR DETAILS.<br />CHOOSE YOUR AIDEX PATH.<br />VERIFY YOUR PAYMENT.</p><span className="registration-hero-mark" aria-hidden="true">+</span></div>;
}

function ParticipantSection({ form, update, blur, errorFor, refs }) {
  return <section className="registration-section" id="registration-details" aria-labelledby="details-heading"><SectionHeading number="01" title="PARTICIPANT DETAILS" copy="TELL US ABOUT YOURSELF." /><div className="registration-fields"><TextField field="fullName" label="FULL NAME" placeholder="Enter your full name" value={form.fullName} onChange={(event) => update('fullName', event.target.value)} onBlur={() => blur('fullName')} error={errorFor('fullName')} inputRef={refs.fullName} autoComplete="name" /><TextField field="email" label="EMAIL ADDRESS" placeholder="you@example.com" type="email" value={form.email} onChange={(event) => update('email', event.target.value)} onBlur={() => blur('email')} error={errorFor('email')} inputRef={refs.email} autoComplete="email" /><TextField field="phone" label="PHONE NUMBER" placeholder="10-digit mobile number" type="tel" value={form.phone} onChange={(event) => update('phone', normalizePhone(event.target.value))} onBlur={() => blur('phone')} error={errorFor('phone')} inputRef={refs.phone} autoComplete="tel" inputMode="numeric" prefix="+91" /></div><fieldset className="registration-choice-fieldset"><legend>YEAR OF STUDY <span aria-hidden="true">*</span></legend><div className="registration-year-grid">{years.map((year, index) => <label className={`registration-year-option${form.year === year.id ? ' is-selected' : ''}`} key={year.id}><input ref={index === 0 ? refs.year : undefined} type="radio" name="year" required value={year.id} checked={form.year === year.id} onChange={() => update('year', year.id)} onBlur={() => blur('year')} aria-describedby={errorFor('year') ? 'year-error' : undefined} /><span className="registration-radio-mark" aria-hidden="true" /><span className="registration-choice-number">{year.number}</span><span>{year.label}</span></label>)}</div><FieldError id="year-error" error={errorFor('year')} /></fieldset></section>;
}

function IeeeSection({ form, update, blur, errorFor, refs, fee }) {
  return <section className="registration-section" id="registration-ieee" aria-labelledby="ieee-heading"><SectionHeading number="02" title="IEEE MEMBERSHIP" copy="ARE YOU AN IEEE MEMBER?" /><fieldset className="registration-choice-fieldset"><legend className="registration-sr-only">IEEE membership status</legend><div className="registration-ieee-grid">{[{ value: true, title: 'YES', subtitle: 'IEEE MEMBER' }, { value: false, title: 'NO', subtitle: 'NON-IEEE' }].map((option, index) => <label className={`registration-ieee-option${form.ieeeMember === option.value ? ' is-selected' : ''}`} key={option.title}><input ref={index === 0 ? refs.ieeeMember : undefined} type="radio" name="ieeeMember" required value={option.title} checked={form.ieeeMember === option.value} onChange={() => update('ieeeMember', option.value)} onBlur={() => blur('ieeeMember')} aria-describedby={errorFor('ieeeMember') ? 'ieeeMember-error' : undefined} /><span className="registration-radio-mark" aria-hidden="true" /><strong>{option.title}</strong><span>{option.subtitle}</span></label>)}</div><FieldError id="ieeeMember-error" error={errorFor('ieeeMember')} /></fieldset>{form.ieeeMember === true && <TextField field="ieeeId" label="IEEE MEMBERSHIP ID" placeholder="Enter your IEEE membership ID" value={form.ieeeId} onChange={(event) => update('ieeeId', event.target.value)} onBlur={() => blur('ieeeId')} error={errorFor('ieeeId')} inputRef={refs.ieeeId} autoComplete="off" />}<div className={`registration-fee-display${fee === null ? ' is-empty' : ''}`}><div><span>REGISTRATION FEE</span><strong>{fee === null ? 'SELECT IEEE STATUS' : formatFee(fee)}</strong></div><span>{fee === null ? 'TO DETERMINE REGISTRATION FEE' : form.ieeeMember ? 'IEEE MEMBER' : 'NON-IEEE'}</span></div></section>;
}

function WorkshopSection({ form, update, blur, errorFor, refs }) {
  return <section className="registration-section" id="registration-workshop" aria-labelledby="workshop-heading"><SectionHeading number="03" title="CHOOSE YOUR AIDEX PATH" copy="SELECT ONE WORKSHOP." /><p className="registration-free-access"><span className="registration-status-dot" aria-hidden="true" /> WORKSHOP ACCESS: FREE <span>/</span> NO ADDITIONAL FEE</p><fieldset className="registration-choice-fieldset"><legend className="registration-sr-only">AIDEX workshop</legend><div className="registration-workshop-grid">{workshops.map((workshop, index) => <label className={`registration-workshop-option registration-accent-${workshop.accent}${form.workshop === workshop.id ? ' is-selected' : ''}`} key={workshop.id}><input ref={index === 0 ? refs.workshop : undefined} type="radio" name="workshop" required value={workshop.id} checked={form.workshop === workshop.id} onChange={() => update('workshop', workshop.id)} onBlur={() => blur('workshop')} aria-describedby={errorFor('workshop') ? 'workshop-error' : undefined} /><span className="registration-workshop-bar">AIDEX / {workshop.number}<span aria-hidden="true">− □ ×</span></span><span className="registration-workshop-body"><strong>{workshop.title}</strong><span className="registration-workshop-select"><span className="registration-radio-mark" aria-hidden="true" />{form.workshop === workshop.id ? 'SELECTED' : 'SELECT PATH'}</span></span></label>)}</div><FieldError id="workshop-error" error={errorFor('workshop')} /></fieldset></section>;
}

function PaymentSection({ form, fee, fileError, onFile, onRemove, errorFor, refs }) {
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const { payment } = registrationConfig;
  useEffect(() => {
    if (!form.paymentProof) { setPreviewUrl(''); return undefined; }
    const objectUrl = URL.createObjectURL(form.paymentProof);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [form.paymentProof]);
  const upiReady = !!(payment.upiId && payment.payeeName && fee !== null);
  const paymentUri = upiReady ? `upi://pay?pa=${encodeURIComponent(payment.upiId)}&pn=${encodeURIComponent(payment.payeeName)}&am=${fee}&cu=INR` : '';
  const proofMessage = fileError || errorFor('paymentProof');
  return <section className="registration-section" id="registration-payment" aria-labelledby="payment-heading"><SectionHeading number="04" title="PAYMENT" copy="PAY THE REGISTRATION FEE AND UPLOAD YOUR PAYMENT PROOF." /><div className="registration-payment-grid"><div className="registration-pay-amount"><span>AMOUNT TO PAY</span><strong>{fee === null ? '—' : formatFee(fee)}</strong><small>{fee === null ? 'SELECT IEEE STATUS FIRST' : form.ieeeMember ? 'IEEE MEMBER' : 'NON-IEEE'}</small></div><div className="registration-payment-method"><div className="registration-qr" aria-label={payment.qrAsset ? 'UPI payment QR code' : ' UPI QRto be configured'}>{payment.qrAsset ? <img src={payment.qrAsset} alt="UPI payment QR code" /> : <span>UPI QR<br />TO BE<br />CONFIGURED</span>}</div><div className="registration-upi"><span>UPI ID</span><strong>{payment.upiId || 'TO BE CONFIGURED'}</strong><div className="registration-upi-actions"><button type="button" disabled={!payment.upiId} onClick={async () => { await navigator.clipboard.writeText(payment.upiId); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }}>{copied ? 'COPIED' : 'COPY UPI ID'}</button><a href={paymentUri || undefined} className={!upiReady ? 'is-disabled' : ''} aria-disabled={!upiReady} onClick={!upiReady ? (event) => event.preventDefault() : undefined}>OPEN UPI APP →</a></div></div></div></div><p className="registration-payment-note">PAYMENT DETAILS ARE NOT YET CONFIGURED. THIS FRONTEND DEMO DOES NOT PROCESS PAYMENTS.</p><div className="registration-proof"><label htmlFor="paymentProof">PAYMENT SCREENSHOT <span aria-hidden="true">*</span></label><p>JPG, PNG OR WEBP · MAX 5 MB</p><input ref={refs.paymentProof} id="paymentProof" name="paymentProof" type="file" required accept="image/jpeg,image/png,image/webp" onChange={onFile} aria-invalid={!!proofMessage} aria-describedby={proofMessage ? 'paymentProof-error' : undefined} /><label className="registration-file-picker" htmlFor="paymentProof">{form.paymentProof ? 'CHANGE SCREENSHOT' : 'SELECT PAYMENT SCREENSHOT'} <span aria-hidden="true">↗</span></label>{form.paymentProof && <div className="registration-file-preview">{previewUrl && <img src={previewUrl} alt="Preview of selected payment screenshot" />}<div><strong>{form.paymentProof.name}</strong><span>{formatSize(form.paymentProof.size)}</span><button type="button" onClick={onRemove}>REMOVE</button></div></div>}<FieldError id="paymentProof-error" error={proofMessage} /></div></section>;
}

function ReviewRow({ label, value, missing }) {
  return <div className="registration-review-row"><dt>{label}</dt><dd className={missing ? 'is-missing' : undefined}>{value || '— NOT PROVIDED'}</dd></div>;
}

function ReviewSection({ form, fee, workshop, year, onEdit, loading }) {
  return <section className="registration-section registration-review-section" id="registration-review" aria-labelledby="review-heading"><SectionHeading number="05" title="REVIEW" copy="CHECK YOUR DETAILS BEFORE SUBMITTING." /><div className="registration-review-window"><div className="registration-review-bar"><span>PARTICIPANT DATA / REVIEW</span><span aria-hidden="true">− □ ×</span></div><dl><ReviewRow label="FULL NAME" value={form.fullName.trim()} /><ReviewRow label="EMAIL" value={form.email.trim()} /><ReviewRow label="PHONE" value={form.phone ? `+91 ${normalizePhone(form.phone)}` : ''} /><ReviewRow label="YEAR" value={year?.label} /><ReviewRow label="IEEE STATUS" value={form.ieeeMember === null ? '' : form.ieeeMember ? 'IEEE MEMBER' : 'NON-IEEE'} />{form.ieeeMember === true && <ReviewRow label="IEEE MEMBERSHIP ID" value={form.ieeeId.trim()} />}<ReviewRow label="AIDEX WORKSHOP" value={workshop?.title} /><ReviewRow label="REGISTRATION FEE" value={fee === null ? '' : formatFee(fee)} /><ReviewRow label="PAYMENT PROOF" value={form.paymentProof ? '✓ ATTACHED' : ''} /></dl><div className="registration-review-edit"><button type="button" onClick={() => onEdit('registration-details', 'fullName')}>EDIT DETAILS ↗</button><button type="button" onClick={() => onEdit('registration-payment', 'paymentProof')}>EDIT PAYMENT ↗</button></div></div><button className="registration-submit" type="submit" disabled={loading}>INITIALIZE REGISTRATION <span aria-hidden="true">→</span></button><p className="registration-submit-note">PAYMENT PROOF WILL BE REVIEWED BEFORE REGISTRATION IS CONFIRMED.</p></section>;
}

function RegistrationStatus({ form, fee, workshop, completion }) {
  return <aside className="registration-sidebar" aria-label="Registration status"><div className="registration-sidebar-bar">// REGISTRATION STATUS <span aria-hidden="true">□ ×</span></div><div className="registration-sidebar-body"><span>FEE</span><strong>{formatFee(fee)}</strong><small>{fee === null ? 'IEEE STATUS REQUIRED' : form.ieeeMember ? 'IEEE MEMBER' : 'NON-IEEE'}</small><span>AIDEX PATH</span><b>{workshop?.title || 'NOT SELECTED'}</b><span>PAYMENT PROOF</span><b className={form.paymentProof ? 'is-ready' : ''}>{form.paymentProof ? '✓ ATTACHED' : 'NOT ATTACHED'}</b><span>COMPLETION</span><b>{completion} / 5</b></div></aside>;
}

function Initializing({ progress }) {
  const lines = ['PARTICIPANT DATA ........ READY', 'AIDEX PATH .............. LOCKED', 'PAYMENT PROOF ........... RECEIVED'];
  return <div className="registration-terminal registration-initializing" role="status" aria-live="polite"><span>// REGISTRATION.EXE</span><h1>INITIALIZING<br />REGISTRATION...</h1><div className="registration-loading-track"><span style={{ width: `${progress * 25}%` }} /></div><strong>{progress * 25}%</strong><div className="registration-loading-lines">{lines.slice(0, Math.min(progress, 3)).map((line) => <p key={line}>{line}</p>)}</div></div>;
}

function Success({ fee, workshop }) {
  return <div className="registration-terminal registration-success" role="status" aria-live="polite"><span>// REGISTRATION RECEIVED</span><div className="registration-success-mark" aria-hidden="true">✓</div><h1>THANK YOU<br />FOR REGISTERING.</h1><div className="registration-success-grid"><div><span>REGISTRATION ID</span><strong>{DEMO_REGISTRATION_ID}</strong></div><div><span>PAYMENT STATUS</span><strong className="registration-pending">● PENDING VERIFICATION</strong></div><div><span>AIDEX PATH</span><strong>{workshop?.title}</strong></div><div><span>REGISTRATION FEE</span><strong>{formatFee(fee)}</strong></div></div><p>Your payment proof has been received and will be reviewed by the VYORA team.</p><p>Your registration will be confirmed after payment verification. Your ticket will be issued after confirmation.</p><div className="registration-success-actions"><a href="/">BACK TO HOME →</a><a href="/#program">VIEW EVENT PROGRAM →</a></div><small>FRONTEND DEMO · NO REGISTRATION HAS BEEN SAVED.</small></div>;
}

export default function RegistrationPage() {
  const [form, setForm] = useState(initialRegistration);
  const [touched, setTouched] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [fileError, setFileError] = useState('');
  const [phase, setPhase] = useState('form');
  const [progress, setProgress] = useState(0);
  const refs = { fullName: useRef(null), email: useRef(null), phone: useRef(null), year: useRef(null), ieeeMember: useRef(null), ieeeId: useRef(null), workshop: useRef(null), paymentProof: useRef(null) };
  const errors = validateRegistration(form);
  const fee = form.ieeeMember === null ? null : form.ieeeMember ? registrationConfig.prices.ieee : registrationConfig.prices.nonIeee;
  const workshop = workshops.find((item) => item.id === form.workshop);
  const year = years.find((item) => item.id === form.year);
  const complete = [!errors.fullName && !errors.email && !errors.phone && !errors.year, !errors.ieeeMember && !errors.ieeeId, !errors.workshop, !errors.paymentProof];
  const current = complete.findIndex((done) => !done) === -1 ? 4 : complete.findIndex((done) => !done);
  const completion = complete.filter(Boolean).length;
  const update = (field, value) => { setForm((previous) => ({ ...previous, [field]: value, ...(field === 'ieeeMember' && value === false ? { ieeeId: '' } : {}) })); if (field === 'paymentProof') setFileError(''); };
  const blur = (field) => setTouched((previous) => ({ ...previous, [field]: true }));
  const errorFor = (field) => attempted || touched[field] ? errors[field] : '';
  const onFile = (event) => { const file = event.target.files?.[0]; if (!file) return; const message = paymentProofError(file); if (message) { setForm((previous) => ({ ...previous, paymentProof: null })); setFileError(message); } else { setFileError(''); update('paymentProof', file); } event.target.value = ''; };
  const onRemove = () => { update('paymentProof', null); setTouched((previous) => ({ ...previous, paymentProof: false })); };
  const onEdit = (id, field) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); window.setTimeout(() => refs[field].current?.focus(), 250); };
  const onSubmit = (event) => { event.preventDefault(); if (phase !== 'form') return; setAttempted(true); const firstError = Object.keys(errors)[0]; if (firstError) { window.requestAnimationFrame(() => { refs[firstError].current?.focus(); refs[firstError].current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }); return; } setPhase('initializing'); setProgress(0); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  useEffect(() => {
    if (phase !== 'initializing') return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const delay = reduced ? 70 : 300;
    const timers = [1, 2, 3, 4].map((step) => window.setTimeout(() => setProgress(step), step * delay));
    timers.push(window.setTimeout(() => setPhase('success'), reduced ? 350 : 1500));
    return () => timers.forEach(window.clearTimeout);
  }, [phase]);

  return <main className="registration-page" id="main-content"><div className="registration-container">{phase === 'success' ? <Success fee={fee} workshop={workshop} /> : phase === 'initializing' ? <Initializing progress={progress} /> : <><RegistrationHero /><Progress current={current} complete={complete} /><div className="registration-layout"><form className="registration-form" noValidate onSubmit={onSubmit}><ParticipantSection form={form} update={update} blur={blur} errorFor={errorFor} refs={refs} /><IeeeSection form={form} update={update} blur={blur} errorFor={errorFor} refs={refs} fee={fee} /><WorkshopSection form={form} update={update} blur={blur} errorFor={errorFor} refs={refs} /><PaymentSection form={form} fee={fee} fileError={fileError} onFile={onFile} onRemove={onRemove} errorFor={errorFor} refs={refs} /><ReviewSection form={form} fee={fee} workshop={workshop} year={year} onEdit={onEdit} loading={false} /></form><RegistrationStatus form={form} fee={fee} workshop={workshop} completion={completion} /></div></>}</div></main>;
}
