import React from 'react';
import desktopLandscape from '../assets/palakkayam-desktop.png';
import mobileLandscape from '../assets/palakkayam-mobile.png';
import seatedAdventurer from '../assets/vyora-adventurer-seated.png';
import './field.css';

function TrekIcon() {
  return <svg viewBox="0 0 76 70" aria-hidden="true"><path d="M5 61 35 10l31 51H5Z" fill="#e4ddc3" stroke="#0c2631" strokeWidth="4" strokeLinejoin="miter"/><path d="m20 61 15-28 16 28M28 23l7-13 10 17" fill="none" stroke="#0c2631" strokeWidth="3"/><path d="m25 42 10-16 9 15" fill="none" stroke="#f08041" strokeWidth="3"/></svg>;
}

function CampfireIcon() {
  return <svg viewBox="0 0 76 70" aria-hidden="true"><path d="m14 56 45 10m4-10L17 66" fill="none" stroke="#142b31" strokeWidth="5" strokeLinecap="square"/><path d="M37 6c-4 12-14 19-14 33 0 12 7 21 17 21s18-9 18-20c0-11-8-19-11-24 1 12-6 13-10 18 2-11-2-15 0-28Z" fill="#f4512e" stroke="#0c2631" strokeWidth="3"/><path d="M40 29c-1 8-8 11-8 20 0 6 4 10 9 10s9-5 9-11c0-6-5-10-6-14-1 5-3 7-4 9 0-5-1-9 0-14Z" fill="#ffdf64"/><path d="m17 57 43 9m1-9-45 9" stroke="#bd6737" strokeWidth="3"/></svg>;
}

function CommunityIcon() {
  return <svg viewBox="0 0 76 70" aria-hidden="true"><g fill="none" stroke="#10252e" strokeWidth="3"><circle cx="38" cy="19" r="10"/><circle cx="15" cy="29" r="8"/><circle cx="61" cy="29" r="8"/><path d="M18 63V48c0-12 9-19 20-19s20 7 20 19v15M4 62V48c0-8 6-14 14-14M72 62V48c0-8-6-14-14-14M38 31v31"/></g></svg>;
}

const activities = [
  { label: 'TREK', Icon: TrekIcon },
  { label: 'CAMPFIRE', Icon: CampfireIcon },
  { label: 'COMMUNITY', Icon: CommunityIcon },
];

function ActivityList() {
  return <ul className="field-activities" aria-label="Field activities">{activities.map(({ label, Icon }) => <li key={label}><Icon /><span>{label}</span></li>)}</ul>;
}

function ExpeditionPanel() {
  return <div className="field-expedition-panel"><ul>{['NATURE', 'PEOPLE', 'IDEAS', 'A BRIGHTER TOMORROW'].map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

function PerspectiveSign() {
  return <aside className="field-perspective-sign" aria-label="Good conversations, better perspectives"><span>GOOD<br />CONVERSATIONS</span><i aria-hidden="true" /><span>BETTER<br />PERSPECTIVES</span></aside>;
}

export default function FieldPage() {
  return (
    <section className="field-page site-section" id="field" aria-labelledby="field-heading">
      <div className="field-scene">
        <picture className="field-art">
          <source media="(max-width: 700px)" srcSet={mobileLandscape} />
          <img src={desktopLandscape} alt="Pixel-art sunset over the layered Palakkayam Thattu mountains and valley" loading="lazy" decoding="async" />
        </picture>
        <div className="field-cliff-art" aria-hidden="true" />
        <div className="field-cream-wash" aria-hidden="true" />
        <p className="field-handwritten">Step out.<br /><span>See further.</span></p>
        <p className="field-coordinates">11.9283° N<br />75.9569° E<br /><span>KANNUR, INDIA</span></p>
        <img className="field-adventurer" src={seatedAdventurer} alt="VYORA adventurer seated on a cliff, looking toward the sunset" loading="lazy" decoding="async" />
        <PerspectiveSign />
      </div>
      <div className="field-intro">
        <p className="field-mission-label">// FIELD MISSION / 04</p>
        <h1 id="field-heading"><span>PALAKKAYAM</span><span>THATTU</span></h1>
        <p className="field-time" aria-label="03:30 PM to 08:00 PM">03:30 PM <span aria-hidden="true">→</span> 08:00 PM</p>
        <ActivityList />
      </div>
      <div className="field-lower">
        <p className="field-mantra">SAME MINDS.<br />HIGHER GROUND.</p>
        <ExpeditionPanel />
      </div>
      <span className="field-mark field-mark-left" aria-hidden="true" />
      <span className="field-mark field-mark-middle" aria-hidden="true" />
      <span className="field-bracket field-bracket-top" aria-hidden="true" />
      <span className="field-bracket field-bracket-bottom" aria-hidden="true" />
    </section>
  );
}
