import React from 'react';
import santhiPortrait from '../assets/speakers/santhi-thilagam.jpeg';
import kasimPortrait from '../assets/speakers/muhammed-kasim-s.jpeg';
import aleenaPortrait from '../assets/speakers/aleena-k-shibu.jpeg';
import landscape from '../assets/tracks-landscape-strip.png';
import adventurer from '../assets/vyora-adventurer-standing.png';
import './people.css';

const speakers = [
  {
    number: '01',
    tone: 'orange',
    name: 'Dr. P. Santhi Thilagam',
    nameLines: ['Dr. P. Santhi', 'Thilagam'],
    role: ['PROFESSOR', 'NITK SURATHKAL'],
    portrait: santhiPortrait,
    icon: 'book',
  },
  {
    number: '02',
    tone: 'blue',
    name: 'Prof. Muhammed Kasim S',
    nameLines: ['Prof. Muhammed', 'Kasim S'],
    role: ['PAST IEEE', 'KERALA SECTION CHAIR'],
    portrait: kasimPortrait,
    icon: 'gear',
  },
  {
    number: '03',
    tone: 'green',
    name: 'Ms. Aleena K Shibu',
    nameLines: ['Ms. Aleena K Shibu'],
    role: ['BMS APPLICATION', 'ENGINEER'],
    portrait: aleenaPortrait,
    icon: 'code',
  },
];

function TalkIcon({ type }) {
  if (type === 'book') return <svg viewBox="0 0 34 34" aria-hidden="true"><path d="M17 8c-4-3-8-3-13-2v21c5-1 9-1 13 2 4-3 8-3 13-2V6c-5-1-9-1-13 2Zm0 0v21" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="miter" /></svg>;
  if (type === 'gear') return <svg viewBox="0 0 34 34" aria-hidden="true"><path d="m14 3 1 3h4l1-3 4 2-1 3 3 3 3-1 2 4-3 2v3l3 1-2 4-3-1-3 3 1 3-4 2-1-3h-4l-1 3-4-2 1-3-3-3-3 1-2-4 3-1v-3l-3-2 2-4 3 1 3-3-1-3 4-2Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="17" cy="17" r="5" fill="none" stroke="currentColor" strokeWidth="2"/></svg>;
  return <svg viewBox="0 0 34 34" aria-hidden="true"><path d="m12 7-8 10 8 10m10-20 8 10-8 10M20 4l-6 26" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"/></svg>;
}

function SpeakerWindow({ speaker }) {
  return <article className={`speaker-window speaker-window-${speaker.tone}`} aria-labelledby={`speaker-${speaker.number}`}>
    <div className="speaker-window-bar"><span className="speaker-window-arrow" aria-hidden="true">▶</span><span>{speaker.number}</span><span className="speaker-window-controls" aria-hidden="true">− □ ×</span></div>
    <div className="speaker-window-body">
      <div className="speaker-photo-frame"><img className="speaker-portrait" src={speaker.portrait} alt={speaker.name} loading="lazy" decoding="async" /></div>
      <div className="speaker-window-copy">
        <h2 id={`speaker-${speaker.number}`}>{speaker.nameLines.map((line) => <span key={line}>{line}</span>)}</h2>
        <p className="speaker-role">{speaker.role.map((line) => <span key={line}>{line}</span>)}</p>
        <span className="speaker-accent-rule" aria-hidden="true" />
        <p className="speaker-talk"><TalkIcon type={speaker.icon} /><span>TECH TALK</span></p>
        <span className="speaker-terminal-lines" aria-hidden="true"><i /><i /><i /></span>
      </div>
    </div>
  </article>;
}

function TechnicalNote() {
  return <aside className="people-technical-note"><p>LEARNING GOES FURTHER<br />WITH DIVERSE VOICES.</p><p>SAME MINDS.<br />BRIGHTER TOMORROW.</p></aside>;
}

export default function PeoplePage() {
  return <section className="people-page site-section" id="people" aria-labelledby="people-heading">
    <img className="people-landscape" src={landscape} alt="" aria-hidden="true" loading="lazy" decoding="async" />
    <span className="people-sky-mask" aria-hidden="true" />
    <span className="people-crosshair people-crosshair-top-left" aria-hidden="true" />
    <span className="people-crosshair people-crosshair-mid-left" aria-hidden="true" />
    <span className="people-crosshair people-crosshair-low-left" aria-hidden="true" />
    <span className="people-crosshair people-crosshair-top-right" aria-hidden="true" />
    <span className="people-crosshair people-crosshair-mid-right" aria-hidden="true" />
    <div className="people-header">
      <div className="people-heading"><p>// PEOPLE.EXE</p><h1 id="people-heading"><span>MEET OUR</span><span>GUEST SPEAKERS.</span></h1></div>
      <p className="people-header-aside">EXPERTS.<br />PERSPECTIVES.<br />REAL-WORLD INSIGHTS.</p>
      <TechnicalNote />
    </div>
    <p className="people-side-note" aria-hidden="true">IDEAS<br />PEOPLE<br />PLACES<br />A BRIGHTER<br />TOMORROW</p>
    <section className="people-speakers" aria-label="Guest speakers">{speakers.map((speaker) => <SpeakerWindow key={speaker.number} speaker={speaker} />)}</section>
    <img className="people-adventurer" src={adventurer} alt="VYORA adventurer standing among the mountains" loading="lazy" decoding="async" />
    <div className="people-dialogue">PEOPLE BUILD<br />BRIGHTER TOMORROWS.<span aria-hidden="true">›</span></div>
    <p className="people-handwritten">Different<br /><span>Journeys.</span><br /><span>Shared Purpose.</span></p>
    <p className="people-footer-meta">VYORA '26<br />VJEC, KANNUR</p>
  </section>;
}
