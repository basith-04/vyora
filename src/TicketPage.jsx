import React, { useCallback, useEffect, useState } from 'react';
import ParticipantTicket from './ParticipantTicket.jsx';
import { registrationApi } from './registrationApi.js';
import './registration.css';

const SESSION_KEY = 'vyora26.ticket.view';

function accessToken() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const fromLink = fragment.get('ticket');
  if (fromLink) {
    sessionStorage.setItem(SESSION_KEY, fromLink);
    window.history.replaceState(window.history.state, '', '/ticket');
    return fromLink;
  }
  return sessionStorage.getItem(SESSION_KEY);
}

export default function TicketPage() {
  const [token] = useState(accessToken);
  const [ticket, setTicket] = useState(null);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setState('error');
      setMessage('This ticket link is missing or invalid.');
      return;
    }
    setState('loading');
    setMessage('');
    try {
      setTicket(await registrationApi.viewTicket(token));
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage(error.message || 'The ticket could not be loaded.');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  return <main className="registration-page ticket-view-page" id="main-content"><div className="registration-container ticket-view-container"><div className="ticket-view-heading"><span>// SECURE TICKET VIEW</span><h1>YOUR VYORA'26 TICKET</h1><p>This link can only display this ticket. It cannot change your registration or payment.</p></div>{state === 'loading' && <ParticipantTicket loading />}{state === 'error' && <ParticipantTicket error={message} onRetry={load} />}{state === 'ready' && <ParticipantTicket ticket={ticket} />}</div></main>;
}
