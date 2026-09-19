import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import desktopHero from '../assets/hero-vjec-desktop.png';
import mobileHero from '../assets/hero-vjec-mobile.png';
import standingAdventurer from '../assets/vyora-adventurer-standing.png';
import ProgramPage from './ProgramPage.jsx';
import TracksPage from './TracksPage.jsx';
import FieldPage from './FieldPage.jsx';
import RegisterPage from './RegisterPage.jsx';
import PeoplePage from './PeoplePage.jsx';
import RegistrationPage from './RegistrationPage.jsx';
import AdminPage from './AdminPage.jsx';
import { Footer, PolicyPage, informationPaths } from './InformationPages.jsx';
import { publicSections } from './siteNavigation.js';

const sectionIds = new Set(publicSections.map(({ id }) => id));

function usePublicSectionTracking(enabled) {
  const [activeSection, setActiveSection] = useState(() => {
    const hash = window.location.hash.slice(1);
    return sectionIds.has(hash) ? hash : 'home';
  });
  const pendingAnchor = useRef(null);

  useLayoutEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    if (!enabled) {
      window.scrollTo(0, 0);
    } else {
      const hash = window.location.hash.slice(1);
      if (sectionIds.has(hash)) {
        const previousBehavior = document.documentElement.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = 'auto';
        document.getElementById(hash)?.scrollIntoView({ block: 'start', behavior: 'instant' });
        document.documentElement.style.scrollBehavior = previousBehavior;
      } else {
        window.scrollTo(0, 0);
      }
    }
    return () => { window.history.scrollRestoration = previousRestoration; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const sections = publicSections.map(({ id }) => document.getElementById(id)).filter(Boolean);
    const header = document.querySelector('.site-header');

    const update = () => {
      const marker = Math.max((header?.getBoundingClientRect().height || 59) + 1, window.innerHeight * .25);
      let current = 'home';
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= marker) current = section.id;
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) current = 'register';
      setActiveSection((previous) => previous === current ? previous : current);

      if (pendingAnchor.current && pendingAnchor.current !== current) return;
      pendingAnchor.current = null;
      const nextHash = `#${current}`;
      if (window.location.hash !== nextHash && !(current === 'home' && !window.location.hash)) {
        window.history.replaceState(window.history.state, '', `/${window.location.search}${nextHash}`);
      }
    };

    const observer = new IntersectionObserver(update, {
      rootMargin: `-${Math.ceil(header?.getBoundingClientRect().height || 59)}px 0px -75% 0px`,
      threshold: 0,
    });
    sections.forEach((section) => observer.observe(section));
    const frame = window.requestAnimationFrame(update);
    const clearPending = () => { pendingAnchor.current = null; };
    const syncHash = () => {
      const hash = window.location.hash.slice(1);
      if (sectionIds.has(hash)) setActiveSection(hash);
    };
    window.addEventListener('wheel', clearPending, { passive: true });
    window.addEventListener('touchstart', clearPending, { passive: true });
    window.addEventListener('hashchange', syncHash);
    window.addEventListener('scrollend', update);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener('wheel', clearPending);
      window.removeEventListener('touchstart', clearPending);
      window.removeEventListener('hashchange', syncHash);
      window.removeEventListener('scrollend', update);
    };
  }, [enabled]);

  return { activeSection, onSectionNavigate: (id) => { pendingAnchor.current = id; setActiveSection(id); } };
}

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

function Navbar({ activeSection, isRegistration, isStandalone, onSectionNavigate }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedSection = isRegistration ? 'register' : isStandalone ? undefined : activeSection;

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
      <a className="brand" href={isStandalone ? '/#home' : '#home'} aria-label="VYORA '26, Home" onClick={() => { setMenuOpen(false); if (!isStandalone) onSectionNavigate('home'); }}>
        <VyoraMark />
        <span>VYORA<span className="brand-apostrophe">'</span>26</span>
      </a>
      <nav className="desktop-nav" aria-label="Main navigation">
        {publicSections.map(({ label, id }) => (
          <a key={id} href={isStandalone ? `/#${id}` : `#${id}`} className={selectedSection === id ? 'active' : undefined} aria-current={!isStandalone && activeSection === id ? 'location' : undefined} onClick={() => { if (!isStandalone) onSectionNavigate(id); }}>{label}</a>
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
        {publicSections.map(({ label, id }, index) => (
          <a key={id} href={isStandalone ? `/#${id}` : `#${id}`} className={selectedSection === id ? 'active' : undefined} aria-current={!isStandalone && activeSection === id ? 'location' : undefined} onClick={() => { setMenuOpen(false); if (!isStandalone) onSectionNavigate(id); }}>
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
        <span>IEEE SB VJEC & IEEE CIS SBC VJEC</span>
        <span>VIMAL JYOTHI ENGINEERING COLLEGE</span>
        <span>CHEMPERI</span>
      </div>
      <div className="event-brief">
        <span>09 — 10 OCT 2026</span>
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
    <div className="registration-status" aria-label="Registration open, limited slots">
      <img src={standingAdventurer} alt="VYORA adventurer" />
      <div className="registration-status-copy">
        <span className="status-open">REGISTRATION OPEN</span>
        <span>LIMITED SLOTS</span>
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
    <section className="home-hero site-section" id="home" aria-labelledby="home-heading">
      <picture className="hero-art">
        <source media="(max-width: 900px)" srcSet={mobileHero} />
        <img src={desktopHero} alt="Pixel-art view of Vimal Jyothi Engineering College beneath a vivid blue sky" fetchPriority="high" />
      </picture>
      <div className="hero-shade" aria-hidden="true" />
      <span className="hero-crosshair crosshair-one" aria-hidden="true" />
      <span className="hero-crosshair crosshair-two" aria-hidden="true" />
      <span className="hero-ruler" aria-hidden="true" />
      <EventMetadata />
      <h1 className="hero-title" id="home-heading"><span>VYORA</span><span className="year">'26</span></h1>
      <JourneyList />
      <div className="registration-group">
        <a className="registration-cta" href="/registration"><span aria-hidden="true">›</span> INITIALIZE REGISTRATION <span aria-hidden="true">→</span></a>
        <RegistrationStatus />
      </div>
      <p className="handwritten-note">Same Minds.<br /><span>Higher Ground.</span></p>
      <LocationPlaque />
    </section>
  );
}

function ChapterBoundary() {
  return <div className="chapter-boundary" aria-hidden="true" />;
}

export default function App() {
  const activePath = window.location.pathname.replace(/\/+$/, '') || '/';
  const isRegistration = activePath === '/registration';
  const isAdmin = activePath === '/admin';
  const isPolicy = informationPaths.has(activePath);
  const isStandalone = isRegistration || isPolicy || isAdmin;
  const { activeSection, onSectionNavigate } = usePublicSectionTracking(!isStandalone);

  useEffect(() => {
    const titles = {
      '/about-us': "About Us | VYORA '26",
      '/contact-us': "Contact Us | VYORA '26",
      '/terms-and-conditions': "Terms & Conditions | VYORA '26",
      '/privacy-policy': "Privacy Policy | VYORA '26",
      '/cancellation-and-refund': "Cancellation & Refund Policy | VYORA '26",
      '/shipping-and-delivery': "Shipping & Delivery Policy | VYORA '26",
    };
    document.title = isAdmin ? "STAFF CONSOLE — VYORA '26" : isRegistration ? "REGISTRATION.EXE — VYORA '26" : titles[activePath] || "VYORA '26 — A Brighter Tomorrow";
  }, [activePath, isAdmin, isRegistration]);

  if (isAdmin) return <AdminPage />;

  return (
    <div className="desktop-surround">
      <div className={`app-shell${isRegistration ? '' : ' public-app-shell'}`}>
        <WindowChrome />
        <Navbar activeSection={activeSection} isRegistration={isRegistration} isStandalone={isStandalone} onSectionNavigate={onSectionNavigate} />
        {isRegistration ? <RegistrationPage /> : isPolicy ? <PolicyPage path={activePath} /> : <main className="public-journey" id="main-content">
          <HomeHero />
          <ChapterBoundary />
          <ProgramPage />
          <ChapterBoundary />
          <TracksPage />
          <ChapterBoundary />
          <PeoplePage />
          <ChapterBoundary />
          <FieldPage />
          <ChapterBoundary />
          <RegisterPage />
          <Footer />
        </main>}
      </div>
    </div>
  );
}
