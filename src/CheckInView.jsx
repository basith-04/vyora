import React, { useCallback, useRef, useState } from 'react';
import QrScanner from './QrScanner.jsx';
import { submitCheckin } from './adminApi.js';
import { checkinPresentation, createScanGate, canRetryCheckin } from './checkinUi.js';
import { formatDate, workshopLabels } from './adminData.js';

function Result({ result, mode, selectedWorkshop, onNext, onRetry }) {
  const presentation = checkinPresentation(result);
  const participant = result?.participant;
  return <section className={`checkin-result result-${presentation.kind}`} role="status" aria-live="assertive">
    <span className="result-icon" aria-hidden="true">{presentation.icon}</span>
    <h2>{presentation.title}</h2>
    {participant && <><strong className="result-name">{participant.fullName}</strong><span>{participant.registrationId}</span><span>{participant.ieeeMember ? 'IEEE Member' : 'Non-IEEE'}</span><span>Workshop: {workshopLabels[participant.workshopId] || participant.workshopId}</span></>}
    {result?.checkedInAt && <span>{result.outcome === 'ALREADY_CHECKED_IN' ? 'Previously checked in' : 'Checked in'}: {formatDate(result.checkedInAt)}</span>}
    {result?.code === 'WORKSHOP_MISMATCH' && <div className="wrong-workshop"><span>Participant registered for: <strong>{workshopLabels[result.details?.registeredWorkshopId]}</strong></span><span>Scanner set to: <strong>{workshopLabels[selectedWorkshop]}</strong></span></div>}
    {!participant && result?.message && <p>{result.message}</p>}
    <small>Mode: {mode === 'EVENT' ? 'Event entrance' : workshopLabels[selectedWorkshop]}</small>
    {canRetryCheckin(result) && <button type="button" onClick={onRetry}>RETRY THIS TICKET</button>}
    <button type="button" onClick={onNext}>SCAN NEXT</button>
  </section>;
}

export default function CheckInView({ auth }) {
  const [mode, setMode] = useState('EVENT');
  const [workshopId, setWorkshopId] = useState('');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [restartKey, setRestartKey] = useState(0);
  const inFlight = useRef(false);
  const scanGate = useRef(createScanGate());
  const lastToken = useRef(null);

  const processToken = useCallback(async (ticketToken) => {
    if (!scanGate.current.claim()) return;
    if (mode === 'WORKSHOP' && !workshopId) {
      setResult({ code: 'WORKSHOP_REQUIRED', message: 'Select the workshop before scanning.' });
      return;
    }
    lastToken.current = ticketToken;
    inFlight.current = true;
    setSubmitting(true);
    setResult(null);
    try {
      setResult(await submitCheckin(auth, {
        ticketToken: ticketToken.trim(),
        type: mode,
        ...(mode === 'WORKSHOP' ? { workshopId } : {}),
      }));
    } catch (error) {
      setResult({ code: error.code || (error.status === 0 ? 'NETWORK_ERROR' : 'CHECKIN_FAILED'), message: error.message, details: error.details });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, [auth, mode, workshopId]);

  const scanNext = () => {
    if (inFlight.current) return;
    scanGate.current.rearm();
    lastToken.current = null;
    setResult(null);
    setManualToken('');
    setRestartKey((value) => value + 1);
  };
  const changeMode = (nextMode) => {
    if (inFlight.current) return;
    scanGate.current.rearm();
    lastToken.current = null;
    setMode(nextMode);
    setResult(null);
    setManualToken('');
    setRestartKey((value) => value + 1);
  };
  const scannerReady = !result && !submitting && (mode === 'EVENT' || Boolean(workshopId));

  return <div className="checkin-layout">
    <section className={`checkin-control mode-${mode.toLowerCase()}`}>
      <p className="admin-kicker">LIVE ATTENDANCE // AUTHORIZED STAFF</p>
      <h2>CHECK-IN MODE</h2>
      <div className="checkin-mode" role="group" aria-label="Check-in mode">
        <button type="button" disabled={submitting} className={mode === 'EVENT' ? 'active' : ''} aria-pressed={mode === 'EVENT'} onClick={() => changeMode('EVENT')}>EVENT</button>
        <button type="button" disabled={submitting} className={mode === 'WORKSHOP' ? 'active' : ''} aria-pressed={mode === 'WORKSHOP'} onClick={() => changeMode('WORKSHOP')}>WORKSHOP</button>
      </div>
      {mode === 'WORKSHOP' && <label className="workshop-mode-select">Workshop<select disabled={submitting} value={workshopId} onChange={(event) => { if (inFlight.current) return; setWorkshopId(event.target.value); scanNext(); }}><option value="">Select workshop before scanning</option>{Object.entries(workshopLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
      <div className="active-mode-banner"><strong>{mode === 'EVENT' ? 'EVENT ENTRANCE' : workshopId ? workshopLabels[workshopId] : 'WORKSHOP NOT SELECTED'}</strong><span>{scannerReady ? 'Scanner ready' : submitting ? 'Processing…' : result ? 'Result ready · scan next to continue' : 'Select required options'}</span></div>
      {!result && <QrScanner active={scannerReady} restartKey={restartKey} onDetected={processToken} />}
      {submitting && <div className="scanner-processing"><div className="admin-spinner" /><strong>VALIDATING WITH SERVER…</strong></div>}
      {result && <Result result={result} mode={mode} selectedWorkshop={workshopId} onNext={scanNext} onRetry={() => { const token = lastToken.current; if (!token || inFlight.current) return; scanGate.current.rearm(); processToken(token); }} />}
    </section>
    <aside className="manual-checkin admin-panel"><h2>Manual QR payload</h2><p>Camera unavailable? Paste the complete payload from a trusted QR reader. Validation still happens on the backend.</p><form onSubmit={(event) => { event.preventDefault(); processToken(manualToken); }}><label>Ticket payload<textarea disabled={submitting} value={manualToken} onChange={(event) => setManualToken(event.target.value)} placeholder="vyora26:t:…" rows="3" /></label><button type="submit" disabled={!manualToken.trim() || submitting || Boolean(result)}>VALIDATE TICKET</button></form></aside>
  </div>;
}
