import React, { useCallback, useEffect, useRef, useState } from 'react';
import QrScanner from './QrScanner.jsx';
import { loadAttendanceSummary, submitCheckin } from './adminApi.js';
import { checkinPresentation, createScanGate, canRetryCheckin } from './checkinUi.js';
import { formatDate, workshopLabels } from './adminData.js';
import { accommodationGroups, checkpoints, groupLabel } from './attendanceConfig.js';

function Result({ result, checkpoint, selectedWorkshop, onNext, onRetry }) {
  const presentation = checkinPresentation(result);
  const participant = result?.participant;
  return <section className={`checkin-result result-${presentation.kind}`} role="status" aria-live="assertive">
    <strong className="attendance-active-label">{checkpoint.banner}</strong>
    <span className="result-icon" aria-hidden="true">{presentation.icon}</span><h2>{presentation.title}</h2>
    {participant && <><strong className="result-name">{participant.fullName}</strong><span>{participant.registrationId}</span><span>Workshop: {workshopLabels[participant.workshopId] || participant.workshopId}</span></>}
    {result?.checkedInAt && <span>{result.outcome === 'ALREADY_CHECKED_IN' ? 'Previously recorded' : 'Recorded'}: {formatDate(result.checkedInAt)}</span>}
    {result?.code === 'WORKSHOP_MISMATCH' && <div className="wrong-workshop"><span>Participant registered for: <strong>{workshopLabels[result.details?.registeredWorkshopId]}</strong></span><span>Scanner set to: <strong>{workshopLabels[selectedWorkshop]}</strong></span></div>}
    {result?.code === 'ACCOMMODATION_GROUP_MISMATCH' && <div className="wrong-workshop"><span>No checkout was recorded.</span><span>Participant belongs to: <strong>{groupLabel(result.details?.registeredGroup)}</strong></span><span>Selected group: <strong>{groupLabel(result.details?.selectedGroup)}</strong></span></div>}
    {!participant && result?.message && result?.code !== 'ACCOMMODATION_GROUP_MISMATCH' && <p>{result.message}</p>}
    {canRetryCheckin(result) && <button type="button" onClick={onRetry}>RETRY THIS TICKET</button>}
    <button type="button" onClick={onNext}>SCAN NEXT</button>
  </section>;
}

export default function CheckInView({ auth }) {
  const [checkpoint, setCheckpoint] = useState(null);
  const [workshopId, setWorkshopId] = useState('');
  const [accommodationGroup, setAccommodationGroup] = useState('ALL');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [restartKey, setRestartKey] = useState(0);
  const [summary, setSummary] = useState(null);
  const [summaryState, setSummaryState] = useState('loading');
  const [summaryError, setSummaryError] = useState('');
  const inFlight = useRef(false);
  const scanGate = useRef(createScanGate());
  const lastToken = useRef(null);
  const summaryGeneration = useRef(0);
  const selectionKey = checkpoint ? JSON.stringify({ type: checkpoint.type,
    ...(checkpoint.workshop ? { workshopId } : {}),
    ...(checkpoint.checkout ? { accommodationGroup } : {}) }) : '';
  const visibleSummary = summary && checkpoint && summary.type === checkpoint.type
    && summary.workshopId === (checkpoint.workshop ? workshopId : null)
    && summary.accommodationGroup === (checkpoint.checkout ? accommodationGroup : null) ? summary : null;

  const refreshSummary = useCallback(async (key, background = false) => {
    if (!key) return;
    const generation = ++summaryGeneration.current;
    if (!background) { setSummary(null); setSummaryState('loading'); }
    else setSummaryState('refreshing');
    try {
      const next = await loadAttendanceSummary(auth, JSON.parse(key));
      if (generation !== summaryGeneration.current) return;
      setSummary(next); setSummaryState('ready'); setSummaryError('');
    } catch (error) {
      if (generation !== summaryGeneration.current) return;
      setSummaryState('stale'); setSummaryError(error.message);
    }
  }, [auth]);

  useEffect(() => {
    if (!selectionKey || (checkpoint?.workshop && !workshopId)) return undefined;
    refreshSummary(selectionKey);
    const interval = setInterval(() => refreshSummary(selectionKey, true), 15000);
    return () => { clearInterval(interval); summaryGeneration.current += 1; };
  }, [selectionKey, checkpoint?.workshop, workshopId, refreshSummary]);

  const processToken = useCallback(async (ticketToken) => {
    if (!scanGate.current.claim()) return;
    if (checkpoint.workshop && !workshopId) {
      setResult({ code: 'WORKSHOP_REQUIRED', message: 'Select the workshop before scanning.' }); return;
    }
    lastToken.current = ticketToken;
    inFlight.current = true; setSubmitting(true); setResult(null);
    try {
      const next = await submitCheckin(auth, { ticketToken: ticketToken.trim(), ...JSON.parse(selectionKey) });
      setResult(next);
      if (next.outcome === 'CHECKED_IN') {
        setSummary((previous) => {
          if (!previous) return previous;
          const remaining = previous.remaining.filter((item) => item.registrationId !== next.participant.registrationId);
          if (remaining.length === previous.remaining.length) return previous;
          return { ...previous, scanned: previous.scanned + 1, remainingCount: previous.remainingCount - 1, remaining };
        });
        refreshSummary(selectionKey, true);
      }
    } catch (error) {
      setResult({ code: error.code || (error.status === 0 ? 'NETWORK_ERROR' : 'CHECKIN_FAILED'), message: error.message, details: error.details });
    } finally { inFlight.current = false; setSubmitting(false); }
  }, [auth, checkpoint, workshopId, selectionKey, refreshSummary]);

  const scanNext = () => {
    if (inFlight.current) return;
    scanGate.current.rearm(); lastToken.current = null;
    setResult(null); setManualToken(''); setRestartKey((value) => value + 1);
  };
  const chooseCheckpoint = (next) => {
    if (inFlight.current) return;
    scanNext(); setWorkshopId(''); setAccommodationGroup('ALL'); setCheckpoint(next);
  };

  if (!checkpoint) return <section className="admin-panel attendance-page"><p className="admin-kicker">VYORA '26 // OPERATIONS</p><h2>ATTENDANCE</h2>
    {[1, 2].map((day) => <div className="attendance-day" key={day}><h3>DAY {day}</h3><div className="attendance-choices">{checkpoints.filter((item) => item.day === day).map((item) =>
      <button type="button" key={item.type} onClick={() => chooseCheckpoint(item)}>{item.label.toUpperCase()} <span aria-hidden="true">→</span></button>)}</div></div>)}
  </section>;

  const scannerReady = !result && !submitting && (!checkpoint.workshop || Boolean(workshopId));
  return <div className="attendance-page">
    <button type="button" className="secondary-button attendance-back" disabled={submitting} onClick={() => chooseCheckpoint(null)}>← Back to Checkpoints</button>
    <div className="attendance-heading"><p className="admin-kicker">DAY {checkpoint.day} // ACTIVE CHECKPOINT</p><h2>{checkpoint.banner}</h2></div>
    {checkpoint.workshop && <label className="attendance-select">Workshop<select disabled={submitting} value={workshopId} onChange={(event) => { if (inFlight.current) return; setWorkshopId(event.target.value); scanNext(); }}><option value="">Select workshop before scanning</option>{Object.entries(workshopLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
    {checkpoint.checkout && <label className="attendance-select">Accommodation Group<select disabled={submitting} value={accommodationGroup} onChange={(event) => { if (inFlight.current) return; setAccommodationGroup(event.target.value); scanNext(); }}>{accommodationGroups.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
    <section className="admin-panel attendance-summary" aria-live="polite"><div className="panel-heading"><h3>Checkpoint progress</h3><button type="button" className="secondary-button" onClick={() => refreshSummary(selectionKey, true)} disabled={summaryState === 'refreshing' || (checkpoint.workshop && !workshopId)}>Refresh</button></div>
      {checkpoint.workshop && !workshopId ? <p>Select a workshop to see its attendance.</p> : <><p className={summaryState === 'stale' ? 'attendance-stale' : 'attendance-status'}>{summaryState === 'loading' ? 'Loading current attendance…' : summaryState === 'refreshing' ? 'Refreshing attendance…' : summaryState === 'stale' ? `Attendance may be stale. ${summaryError}` : 'Current as of last refresh · updates every 15 seconds'}</p>
        {visibleSummary && <div className="attendance-metrics"><div><span>Expected</span><strong>{visibleSummary.expected}</strong></div><div><span>{checkpoint.action}</span><strong>{visibleSummary.scanned}</strong></div><div><span>Remaining</span><strong>{visibleSummary.remainingCount}</strong></div></div>}</>}
    </section>
    <div className="checkin-layout"><section className={`checkin-control mode-${checkpoint.type.toLowerCase()}`}><div className="active-mode-banner"><strong>{checkpoint.banner}</strong><span>{scannerReady ? 'Scanner ready' : submitting ? 'Processing…' : result ? 'Result ready · scan next to continue' : 'Select required options'}</span></div>
      {!result && <QrScanner active={scannerReady} restartKey={restartKey} onDetected={processToken} />}
      {submitting && <div className="scanner-processing"><div className="admin-spinner" /><strong>VALIDATING WITH SERVER… · {checkpoint.banner}</strong></div>}
      {result && <Result result={result} checkpoint={checkpoint} selectedWorkshop={workshopId} onNext={scanNext} onRetry={() => { const token = lastToken.current; if (!token || inFlight.current) return; scanGate.current.rearm(); processToken(token); }} />}
    </section><aside className="manual-checkin admin-panel"><h2>Manual QR payload</h2><p>Camera unavailable? Paste the complete payload from a trusted QR reader. Validation still happens on the backend.</p><form onSubmit={(event) => { event.preventDefault(); processToken(manualToken); }}><label>Ticket payload<textarea disabled={submitting} value={manualToken} onChange={(event) => setManualToken(event.target.value)} placeholder="vyora26:t:…" rows="3" /></label><button type="submit" disabled={!manualToken.trim() || submitting || Boolean(result) || !scannerReady}>VALIDATE TICKET</button></form></aside></div>
    <section className="admin-panel attendance-remaining"><div className="panel-heading"><h3>{checkpoint.remaining}</h3><span>{visibleSummary?.remainingCount ?? '—'} participants</span></div>{summaryState === 'stale' && <p className="attendance-stale">Refresh before making a final headcount.</p>}
      {visibleSummary?.remaining.length ? <ul>{visibleSummary.remaining.map((item) => <li key={item.registrationId}><strong>{item.fullName}</strong><span>{item.registrationId}</span>{checkpoint.checkout && <small>{groupLabel(item.accommodationGroup)}</small>}</li>)}</ul> : <p>{visibleSummary ? 'Everyone in this selection has been accounted for.' : checkpoint.workshop && !workshopId ? 'Select a workshop to see its remaining participants.' : summaryState === 'stale' ? 'Participant list unavailable. Retry the summary.' : 'Loading participant list…'}</p>}
    </section>
  </div>;
}
