import React, { useEffect, useState } from 'react';
import desktopHero from '../assets/hero-vjec-desktop.png';
import mobileHero from '../assets/hero-vjec-mobile.png';
import standingAdventurer from '../assets/vyora-adventurer-standing.png';
import ProgramPage from './ProgramPage.jsx';
import TracksPage from './TracksPage.jsx';
import FieldPage from './FieldPage.jsx';

const navigation = [
  { label: 'Home', href: '/' },
  { label: 'Program', href: '/program' },
  { label: 'Tracks', href: '/tracks' },
  { label: 'People', href: '/people' },
  { label: 'Field', href: '/field' },
  { label: 'Register', href: '/register' },
];

function VyoraMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 58 54" aria-hidden="true" focusable="false">
      <path d="M29 4 4 48h50L29 4Z" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="m29 13 16 29H34l-5-9-5 9H13l16-29Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="m19 40 10-18 10 18M25 34h8" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M29 5v9M5 48h11M42 48h11" stroke="currentColor" strokeWidth="1" />
      <circle cx="29" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}

function WindowChrome() {
  return (
    <div className="window-chrome" aria-hidden="true">
      <div className="chrome-lights"><i /><i /><i /></div>
      <span className="chrome-dashes">∷</span>
      <div className="chrome-tools"><span>−</span><span>□</span><span>×</span></div>
    </div>
  );
}

function Navbar({ activePath }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="VYORA '26, Home" onClick={() => setMenuOpen(false)}>
        <VyoraMark />
        <span>VYORA<span className="brand-apostrophe">'</span>26</span>
      </a>
      <nav className="desktop-nav" aria-label="Main navigation">
        {navigation.map(({ label, href }) => (
          <a key={label} href={href} className={activePath === href ? 'active' : undefined} aria-current={activePath === href ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      <span className="header-motto" aria-hidden="true"><span>────→</span> A BRIGHTER TOMORROW</span>
      <button
        className="menu-toggle"
        type="button"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        aria-controls="mobile-navigation"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span /><span /><span />
      </button>
      <nav id="mobile-navigation" className={`mobile-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Mobile navigation" inert={!menuOpen}>
        <span className="mobile-nav-heading">// SELECT DESTINATION</span>
        {navigation.map(({ label, href }, index) => (
          <a key={label} href={href} className={activePath === href ? 'active' : undefined} aria-current={activePath === href ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
            <span className="nav-index">0{index + 1}</span>{label}<span className="nav-arrow">→</span>
          </a>
        ))}
        <span className="mobile-nav-footer">A BRIGHTER TOMORROW</span>
      </nav>
    </header>
  );
}

function EventMetadata() {
  return (
    <div className="event-metadata" aria-label="Event details">
      <div className="event-host">
        <span>IEEE SB × IEEE CIS</span>
        <span>VIMAL JYOTHI ENGINEERING COLLEGE</span>
        <span>KANNUR, INDIA</span>
      </div>
      <div className="event-brief">
        <span>09 — 10 OCT 2026</span>
        <span>NATIONAL LEVEL</span>
        <span>SYSTEM ID: VYR-26</span>
      </div>
    </div>
  );
}

function JourneyList() {
  return (
    <ul className="journey-list" aria-label="The VYORA journey">
      {['Learn', 'Collaborate', 'Explore', 'Belong'].map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

function RegistrationStatus() {
  return (
    <div className="registration-status" aria-label="Registration open, 150 participant slots">
      <img src={standingAdventurer} alt="VYORA adventurer" />
      <div className="registration-status-copy">
        <span className="status-open">REGISTRATION OPEN</span>
        <span>150 PARTICIPANT SLOTS</span>
      </div>
    </div>
  );
}

function LocationPlaque() {
  return (
    <aside className="location-plaque" aria-label="Vimal Jyothi Engineering College, Kannur, 11.9283 degrees north, 75.9569 degrees east">
      <strong>VJEC</strong>
      <span>KANNUR</span>
      <small>11.9283° N<br />75.9569° E</small>
    </aside>
  );
}

function HomeHero() {
  return (
    <main className="home-hero" id="main-content">
      <picture className="hero-art">
        <source media="(max-width: 900px)" srcSet={mobileHero} />
        <img src={desktopHero} alt="Pixel-art view of Vimal Jyothi Engineering College beneath a vivid blue sky" fetchPriority="high" />
      </picture>
      <div className="hero-shade" aria-hidden="true" />
      <span className="hero-crosshair crosshair-one" aria-hidden="true" />
      <span className="hero-crosshair crosshair-two" aria-hidden="true" />
      <span className="hero-ruler" aria-hidden="true" />
      <EventMetadata />
      <h1 className="hero-title"><span>VYORA</span><span className="year">'26</span></h1>
      <p className="hero-tagline"><span>TWO DAYS.</span><span>THREE TRACKS.</span><span>ONE EXPEDITION INTO</span><span className="tagline-highlight">WHAT COMES NEXT.</span></p>
      <JourneyList />
      <div className="registration-group">
        <a className="registration-cta" href="/register"><span aria-hidden="true">›</span> INITIALIZE REGISTRATION <span aria-hidden="true">→</span></a>
        <RegistrationStatus />
      </div>
      <p className="handwritten-note">Same Minds.<br /><span>Higher Ground.</span></p>
      <LocationPlaque />
    </main>
  );
}

export default function App() {
  const activePath = window.location.pathname.replace(/\/+$/, '') || '/';
  const isProgram = activePath === '/program';
  const isTracks = activePath === '/tracks';
  const isField = activePath === '/field';

  useEffect(() => {
    document.title = isField ? "FIELD MISSION — VYORA '26" : isTracks ? "TRACKS.EXE — VYORA '26" : isProgram ? "PROGRAM.EXE — VYORA '26" : "VYORA '26 — A Brighter Tomorrow";
  }, [isProgram, isTracks, isField]);

  return (
    <div className="desktop-surround">
      <div className="app-shell">
        <WindowChrome />
        <Navbar activePath={activePath} />
        {isField ? <FieldPage /> : isTracks ? <TracksPage /> : isProgram ? <ProgramPage /> : <HomeHero />}
      </div>
    </div>
  );
}
