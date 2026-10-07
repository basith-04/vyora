import React, { useEffect, useState } from 'react';
import { searchAttendanceParticipants } from './adminApi.js';
import { workshopLabels } from './adminData.js';
import { groupLabel } from './attendanceConfig.js';

export default function ManualCheckin({ auth, checkpoint, workshopId, accommodationGroup,
  disabled, selected, onSelect, onConfirm }) {
  const [query, setQuery] = useState('');
  const [participants, setParticipants] = useState([]);
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setParticipants([]); setError('');
    if (query.trim().length < 2 || disabled || selected) { setState('idle'); return undefined; }
    let cancelled = false;
    const controller = new AbortController();
    setState('loading');
    const timer = setTimeout(async () => {
      try {
        const result = await searchAttendanceParticipants(auth, query.trim(), { signal: controller.signal });
        if (cancelled) return;
        setParticipants(result.participants); setState('ready');
      } catch (failure) {
        if (cancelled) return;
        setError(failure.message); setState('error');
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [auth, query, disabled, selected, retry]);

  return <aside className="manual-checkin admin-panel"><h2>MANUAL CHECK-IN</h2>
    <p>Camera unavailable? Search by name, select the participant, then confirm.</p>
    {selected ? <div className="manual-confirmation">
      <strong className="manual-name">{selected.fullName}</strong>
      <span>Registration: {selected.registrationId}</span>
      <span>Workshop: {workshopLabels[selected.workshopId] || selected.workshopId}</span>
      {selected.accommodationGroup && <span>Accommodation: {groupLabel(selected.accommodationGroup)}</span>}
      <strong>Checkpoint: {checkpoint.banner}</strong>
      {checkpoint.workshop && <span>Selected workshop: {workshopLabels[workshopId]}</span>}
      {checkpoint.checkout && <strong>Selected group: {groupLabel(accommodationGroup)}</strong>}
      <div className="manual-actions"><button type="button" className="secondary-button" disabled={disabled} onClick={() => onSelect(null)}>CANCEL</button>
        <button type="button" disabled={disabled} onClick={onConfirm}>CHECK IN</button></div>
    </div> : <>
      <label>Participant name<input type="search" value={query} maxLength={120} disabled={disabled}
        placeholder="Search participant by name…" onChange={(event) => { setQuery(event.target.value); setParticipants([]); }} /></label>
      <div role="status" aria-live="polite">
        {state === 'idle' && !disabled && <p>Enter at least 2 characters.</p>}
        {state === 'loading' && <p>Searching participants…</p>}
        {state === 'ready' && !participants.length && <p>No eligible participants match this name.</p>}
        {state === 'error' && <><p>{error}</p><button type="button" className="secondary-button" onClick={() => setRetry((value) => value + 1)}>RETRY SEARCH</button></>}
      </div>
      {participants.length > 0 && <ul className="manual-matches">{participants.map((participant) => <li key={participant.registrationDocId}>
        <button type="button" disabled={disabled} onClick={() => onSelect(participant)}>
          <strong className="manual-name">{participant.fullName}</strong><span>{participant.registrationId}</span>
          <span>Workshop: {workshopLabels[participant.workshopId] || participant.workshopId}</span>
          {participant.accommodationGroup && <span>Accommodation: {groupLabel(participant.accommodationGroup)}</span>}
        </button></li>)}</ul>}
    </>}
  </aside>;
}
