import React, { useState } from 'react';
import landscape from '../assets/egister-vjec-landscape-strip.png';
import adventurer from '../assets/vyora-adventurer-standing.png';
import { registrationOptions } from './registrationOptions.js';
import { REGISTRATION_CLOSED_LABEL } from './registrationAvailability.js';
import './register.css';

const tiers = [
  { id: 'ieee', label: 'IEEE MEMBER', lines: ['IEEE MEMBER', 'STANDARD'], price: registrationOptions.prices.ieee },
  { id: 'non-ieee', label: 'NON-IEEE', lines: ['NON-IEEE', 'STANDARD'], price: registrationOptions.prices.nonIeee },
];

function MemberIcon() {
  return <svg viewBox="0 0 80 80" aria-hidden="true"><path d="M40 4 75 40 40 76 5 40 40 4Z" fill="#f3f1e9" /><path d="M40 12 67 40 40 68 13 40 40 12Z" fill="none" stroke="#102b3b" strokeWidth="3" /><path d="M39 24v33m-8-25 8-7 8 7m-16 17 8 7 8-7" fill="none" stroke="#102b3b" strokeWidth="4" strokeLinecap="square" /><circle cx="40" cy="18" r="3" fill="#102b3b" /><circle cx="40" cy="62" r="3" fill="#102b3b" /></svg>;
}

function PeopleIcon({ className = '' }) {
  return <svg className={className} viewBox="0 0 72 64" aria-hidden="true"><g fill="currentColor"><circle cx="36" cy="13" r="10"/><circle cx="14" cy="21" r="7"/><circle cx="58" cy="21" r="7"/><path d="M20 51V39c0-10 7-17 16-17s16 7 16 17v12H20ZM2 48V38c0-8 5-13 12-13 3 0 5 1 7 2-4 4-6 9-6 15v9H5a3 3 0 0 1-3-3Zm68 0V38c0-8-5-13-12-13-3 0-5 1-7 2 4 4 6 9 6 15v9h10a3 3 0 0 0 3-3Z"/></g></svg>;
}

function CalendarIcon() {
  return <svg viewBox="0 0 72 72" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="square"><path d="M9 15h54v50H9zM9 28h54M23 7v16M49 7v16"/><path d="M20 39h7m10 0h7m9 0h1M20 51h7m10 0h7m9 0h1" strokeWidth="4"/></g></svg>;
}

function PinIcon() {
  return <svg viewBox="0 0 72 78" aria-hidden="true"><path d="M36 4C19 4 8 16 8 32c0 19 28 42 28 42s28-23 28-42C64 16 53 4 36 4Z" fill="currentColor"/><circle cx="36" cy="31" r="10" fill="var(--vyora-paper)"/></svg>;
}

function WireframeMountains() {
  return <svg className="register-wireframe" viewBox="0 0 420 76" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="#087bac" strokeWidth=".6" opacity=".86"><path d="M0 67 33 53 55 62 99 39 128 45 177 66 237 49 286 22 327 69 361 40 420 65"/><path d="M0 73 33 58 55 67 99 45 128 51 177 71 237 55 286 29 327 74 361 46 420 71"/><path d="M0 60 33 48 55 56 99 33 128 39 177 59 237 43 286 17 327 61 361 35 420 59"/><path d="M0 69h420M0 62h420M0 55h420M0 48h420M0 41h420M33 48v25M55 56v20M99 33v43M128 39v37M177 59v17M237 43v33M286 17v59M327 61v15M361 35v41" strokeDasharray="2 3"/></g></svg>;
}

function RegistrationTier({ tier, selected, onSelect }) {
  return <button className={`register-tier register-tier-${tier.id}${selected ? ' is-selected' : ''}`} type="button" aria-pressed={selected} onClick={onSelect}>
    <span className="register-tier-bar"><span className="register-tier-chevron" aria-hidden="true">▶</span>{tier.label}<span className="register-tier-controls" aria-hidden="true">− □ ×</span></span>
    <span className="register-tier-body">
      <span className="register-tier-identity">{tier.id === 'ieee' ? <MemberIcon /> : <PeopleIcon />}<span><strong>{tier.lines[0]}</strong><small>{tier.lines[1]}</small></span></span>
      <span className="register-tier-rule" />
      <strong className="register-tier-price">₹{tier.price}</strong>
      <span className="register-tier-unit">PER PARTICIPANT</span>
      <WireframeMountains />
    </span>
  </button>;
}

const facts = [
  { label: 'REGISTRATION', value: 'CLOSED', Icon: PeopleIcon },
  { label: 'DATE', value: '09–10 OCT 2026', Icon: CalendarIcon },
  { label: 'VENUE', value: 'VJEC, KANNUR', Icon: PinIcon },
];

function EventFacts() {
  return <aside className="register-facts" aria-label="Event information">{facts.map(({ label, value, Icon }) => <div className="register-fact" key={label}><Icon /><span><small>{label}</small><strong>{value}</strong></span></div>)}</aside>;
}

export default function RegisterPage() {
  const [selectedTier, setSelectedTier] = useState('ieee');
  const ctaContent = <>{REGISTRATION_CLOSED_LABEL} <span aria-hidden="true">■</span></>;

  return <section className="register-page site-section" id="register" aria-labelledby="register-heading">
    <img className="register-landscape" src={landscape} alt="Pixel-art mountains, forests, and Vimal Jyothi Engineering College" loading="lazy" decoding="async" />
    <span className="register-crosshair register-crosshair-one" aria-hidden="true" />
    <span className="register-crosshair register-crosshair-two" aria-hidden="true" />
    <span className="register-crosshair register-crosshair-three" aria-hidden="true" />
    <span className="register-crosshair register-crosshair-four" aria-hidden="true" />
    <div className="register-heading"><p>// REGISTER.EXE — INITIALIZATION</p><h1 id="register-heading">READY TO BEGIN?</h1><p>SELECT YOUR REGISTRATION TIER AND INITIALIZE.</p></div>
    <aside className="register-annotation">SAME MINDS.<br />MORE POSSIBILITIES.<br />A BRIGHTER TOMORROW.</aside>
    <p className="register-side-note" aria-hidden="true">IDEAS<br />PEOPLE<br />PLACES<br />A BRIGHTER<br />TOMORROW</p>
    <div className="register-content"><section className="register-tiers" aria-label="Registration tiers">{tiers.map((tier) => <RegistrationTier key={tier.id} tier={tier} selected={selectedTier === tier.id} onSelect={() => setSelectedTier(tier.id)} />)}</section><EventFacts /></div>
    <div className="register-action"><span className="register-action-button is-closed" aria-disabled="true">{ctaContent}</span></div>
    <img className="register-adventurer" src={adventurer} alt="VYORA adventurer standing at the VJEC destination" loading="lazy" decoding="async" />
    <div className="register-dialogue">SAME PATHS.<br />BRIGHTER TOMORROWS.<span aria-hidden="true">›</span></div>
    <p className="register-footer-meta">VYORA '26<br />VJEC, KANNUR</p>
  </section>;
}
