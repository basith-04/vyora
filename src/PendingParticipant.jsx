import React, { useEffect, useState } from 'react';
import { groupLabel } from './attendanceConfig.js';
import { copyParticipantPhone, participantContact } from './participantContact.js';

export default function PendingParticipant({ participant }) {
  const contact = participantContact(participant.phone);
  const accommodation = participant.accommodationGroup === 'STAY'
    ? `STAY${participant.stayType === 'AC' ? ' • AC' : participant.stayType === 'NON_AC' ? ' • NON-AC' : ''}`
    : participant.accommodationGroup ? groupLabel(participant.accommodationGroup).toUpperCase() : 'NO STAY';
  const [copyState, setCopyState] = useState('');
  useEffect(() => {
    if (copyState !== 'copied') return undefined;
    const timer = setTimeout(() => setCopyState(''), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  const copy = async (event) => {
    event.stopPropagation();
    setCopyState(await copyParticipantPhone(participant.phone) ? 'copied' : 'failed');
  };

  return <li><details className="pending-contact">
    <summary><strong>{participant.fullName}</strong><small className="pending-contact-hint">CONTACT ▾</small>
      <span>{participant.registrationId}</span><small>{accommodation}</small>{participant.day1Absent === true && <small className="attendance-absence">DAY 1 ABSENT</small>}
    </summary>
    <div className="pending-contact-body">
      {contact ? <span className="pending-phone">{contact.number}</span> : <small>Phone number unavailable or invalid.</small>}
      <div className="pending-contact-actions">
        {contact ? <a href={contact.href} onClick={(event) => event.stopPropagation()}>CALL</a> : <button type="button" disabled>CALL</button>}
        <button type="button" className="secondary-button" disabled={!contact} onClick={copy}>{copyState === 'copied' ? 'COPIED' : 'COPY NUMBER'}</button>
      </div>
      <small role="status" aria-live="polite">{copyState === 'copied' ? 'Number copied.' : copyState === 'failed' ? 'Copy unavailable. Select the number and copy it.' : ''}</small>
    </div>
  </details></li>;
}
