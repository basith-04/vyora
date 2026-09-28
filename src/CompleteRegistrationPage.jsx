import React, { useRef, useState } from 'react';
import { FieldError, TextField, RadioChoice } from './RegistrationControls.jsx';
import { completionErrors, GENDER_OPTIONS, FOOD_OPTIONS, HEALTH_NOTE_MAX_LENGTH } from '../functions/shared/completion.js';
import { registrationApi } from './registrationApi.js';
import './registration.css';
import './complete-registration.css';

const messages = {
  REGISTRATION_NOT_FOUND: 'No eligible registration was found with this Registration ID. Please check your Registration ID and try again.',
  ALREADY_COMPLETED: 'Registration details have already been submitted. Please contact the organizers if a correction is required.',
  RATE_LIMITED: 'Too many attempts. Please try again later.',
};
export default function CompleteRegistrationPage() {
  const [form, setForm] = useState({ registrationId: '', gender: '', foodPreference: '', healthSafetyConcern: null, healthSafetyNote: '', termsAccepted: false });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const submitting = useRef(false);
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value, ...(field === 'healthSafetyConcern' && value === false ? { healthSafetyNote: '' } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setMessage('');
  }
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    const fields = completionErrors(form);
    setErrors(fields);
    if (Object.keys(fields).length) return;
    submitting.current = true; setBusy(true); setMessage('');
    try {
      const result = await registrationApi.complete({ ...form, registrationId: form.registrationId.trim(), healthSafetyNote: form.healthSafetyConcern ? form.healthSafetyNote : null });
      if (result.success === true) { setSuccess(true); setForm({ registrationId: '', gender: '', foodPreference: '', healthSafetyConcern: null, healthSafetyNote: '', termsAccepted: false }); }
      else if (result.code === 'INVALID_COMPLETION' && result.fields) setErrors(result.fields);
      else setMessage(messages[result.code] || 'Unable to submit details. Please try again.');
    } catch { setMessage('Unable to submit details. Please try again.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <main className="registration-page" id="main-content"><div className="registration-container completion-container">
    <div className="registration-hero"><span className="registration-exe">// VYORA '26</span><h1>COMPLETE<br /><span>YOUR DETAILS.</span></h1></div>
    {success ? <div className="registration-terminal registration-success" role="status">✓ Details submitted successfully.</div> : <form className="registration-form completion-form" noValidate onSubmit={submit}>
      <fieldset className="registration-section completion-fields" disabled={busy}>
        <TextField field="registrationId" label="REGISTRATION ID" value={form.registrationId} onChange={(e) => update('registrationId', e.target.value)} error={errors.registrationId} autoComplete="off" />
        <RadioChoice field="gender" legend="GENDER" options={GENDER_OPTIONS} value={form.gender} onChange={update} error={errors.gender} />
        <RadioChoice field="foodPreference" legend="FOOD PREFERENCE" options={FOOD_OPTIONS} value={form.foodPreference} onChange={update} error={errors.foodPreference} />
        <h2>HEALTH / SAFETY INFORMATION</h2>
        <RadioChoice field="healthSafetyConcern" legend="Do you have any health condition, medication requirement, allergy, or other concern we should know about for trekking/outdoor activities?" options={[{ label: 'No', value: false }, { label: 'Yes', value: true }]} value={form.healthSafetyConcern} onChange={update} error={errors.healthSafetyConcern} />
        {form.healthSafetyConcern === true && <div className="registration-field completion-note"><label htmlFor="healthSafetyNote">Please briefly mention anything the organizers should know to assist you if needed:</label><div className="registration-input-wrap"><textarea id="healthSafetyNote" name="healthSafetyNote" rows={3} required maxLength={HEALTH_NOTE_MAX_LENGTH} value={form.healthSafetyNote} onChange={(e) => update('healthSafetyNote', e.target.value)} aria-invalid={!!errors.healthSafetyNote} aria-describedby="healthSafetyNote-error" /></div><FieldError id="healthSafetyNote-error" error={errors.healthSafetyNote} /></div>}
        <p className="registration-payment-note">This information is collected only to help the organizing team plan appropriate assistance and respond to emergencies during the event.</p>
        <div className="completion-terms">
          <label className="registration-payment-note" htmlFor="termsAccepted"><input id="termsAccepted" name="termsAccepted" type="checkbox" required checked={form.termsAccepted} onChange={(e) => update('termsAccepted', e.target.checked)} aria-invalid={!!errors.termsAccepted} aria-describedby={errors.termsAccepted ? 'termsAccepted-error' : undefined} /><span>I have read and accept the <a href="/terms-and-conditions" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a>.</span></label>
          <FieldError id="termsAccepted-error" error={errors.termsAccepted} />
        </div>
        <button className="registration-submit" type="submit" disabled={busy}>{busy ? 'SUBMITTING...' : 'SUBMIT'} <span aria-hidden="true">→</span></button>
      </fieldset>
      {message && <p className="registration-error" role="alert">{message}</p>}
    </form>}
  </div></main>;
}
