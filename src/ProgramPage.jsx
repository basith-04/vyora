import React from 'react';
import journeyArt from '../assets/program-journey-strip.png';
import './program.css';

const days = [
  {
    number: '01',
    theme: 'IGNITION',
    date: '09 OCT 2026',
    isoDate: '2026-10-09',
    tone: 'orange',
    entries: [
      { start: '4:30 PM', title: 'ARRIVAL', detail: 'Registration' },
      { start: '5:50 PM', title: 'SYSTEM START', detail: 'Inauguration Ceremony' },
      { start: '6:30 PM', title: 'TRANSMISSION 01', detail: 'Technical Talk' },
      { start: '7:10 PM', title: 'REFUEL', detail: 'Dinner' },
      { start: '8:00 PM', title: 'NIGHT MODE', detail: 'Ice-Breaking Session' },
      { start: '8:40 PM', title: 'BEYOND CONSCIOUS' },
      { start: '9:00 PM', title: 'MUSICAL NIGHT' },
      { start: '10:00 PM', title: 'HOSTEL DROP-OFF', terminal: true },
    ],
  },
  {
    number: '02',
    theme: 'COMPETE',
    date: '10 OCT 2026',
    isoDate: '2026-10-10',
    tone: 'blue',
    entries: [
      { start: '7:45 AM', title: 'BREAKFAST', compact: true },
      { start: '8:50 AM', title: 'WORKSHOP CHECK-IN', compact: true },
      {
        start: '9:00 AM',
        title: 'PARALLEL WORKSHOPS',
        kind: 'workshops',
        tracks: [
          {
            number: '01',
            title: 'DATA SCIENCE AND ANALYTICS USING PYTHON',
            people: 'Sreeram M R',
            tone: 'orange',
          },
          {
            number: '02',
            title: 'AI / ML / DATA SCIENCE',
            people: 'Abhinav I · Usmanul Faris K S · Abhiram M S',
            tone: 'blue',
          },
          {
            number: '03',
            title: 'GITHUB × AI',
            people: 'Josin Joseph · Samanway T K',
            tone: 'green',
          },
        ],
      },
      { start: '10:00 AM', title: 'PANEL DISCUSSION', compact: true },
      { start: '10:30 AM', title: 'TREASURE HUNT', compact: true },
      { start: '12:00 PM', title: 'LUNCH', compact: true },
      { start: '1:00 PM', title: 'TECHNICAL TALK' },
      {
        start: '2:00 PM',
        title: 'BOARDING',
        detail: 'Palakayam Thattu Trekking',
      },
      {
        start: '6:00 PM',
        title: 'RETURN TO COLLEGE',
        compact: true,
      },
      {
        start: '7:15 PM',
        title: 'CAMPFIRE',
      },
      {
        start: '8:30 PM',
        title: 'REELS PROJECTION',
        detail: 'Winner Selection',
      },
      { start: '9:00 PM', title: 'DINNER', compact: true },
      {
        start: '10:00 PM',
        title: 'EVENT CONCLUDES',
        compact: true,
        terminal: true,
      },
    ],
  },
];
function WorkshopGroup({ tracks }) {
  return (
    <ul className="workshop-tracks" aria-label="Three parallel workshop tracks">
      {tracks.map((track) => (
        <li key={track.number} className={`workshop-track track-${track.tone}`}>
          <span className="track-number">{track.number}</span>
          <span className="track-copy"><strong>{track.title}</strong><small>{track.people}</small></span>
        </li>
      ))}
    </ul>
  );
}

function ScheduleEntry({ entry, isoDate }) {
  return (
    <li className={`schedule-entry ${entry.kind === 'workshops' ? 'is-workshop' : ''} ${entry.compact ? 'is-compact' : ''} ${entry.terminal ? 'is-terminal' : ''}`}>
      <div className="schedule-time" aria-label={`${entry.start} to ${entry.end}`}>
        <time dateTime={`${isoDate}T${entry.start}`}>{entry.start}</time>
        <span>→ {entry.end}</span>
      </div>
      <span className="timeline-node" aria-hidden="true" />
      <div className="schedule-copy">
        <strong>{entry.title}</strong>
        {entry.detail && <span className="schedule-detail">{entry.detail}</span>}
        {entry.notes?.map((note) => <span className="schedule-note" key={note}>{note}</span>)}
        {entry.tracks && <WorkshopGroup tracks={entry.tracks} />}
      </div>
    </li>
  );
}

function DaySchedule({ day }) {
  return (
    <section className={`day-schedule day-${day.tone}`} aria-labelledby={`day-${day.number}-title`}>
      <header className="day-header">
        <span className="day-diamond" aria-hidden="true">✦</span>
        <div className="day-heading">
          <h2 id={`day-${day.number}-title`}>DAY {day.number} <span className="day-slash">/</span> <em>{day.theme}</em></h2>
          <span className="day-date">{day.date}</span>
        </div>
        <span className="day-window-controls" aria-hidden="true">− &nbsp; □ &nbsp; ×</span>
      </header>
      <ol className="schedule-list">
        {day.entries.map((entry) => <ScheduleEntry entry={entry} isoDate={day.isoDate} key={`${entry.start}-${entry.title}`} />)}
      </ol>
    </section>
  );
}

function MissionStatus() {
  return (
    <div className="mission-status" aria-label="Day 01 complete, progress saved. Next mission: Day 02, Compete">
      <span className="mission-glyph" aria-hidden="true">△</span>
      <div className="mission-progress"><strong>DAY 01 COMPLETE</strong><span>PROGRESS SAVED</span></div>
      <span className="mission-arrow" aria-hidden="true">→</span>
      <div className="mission-next"><span>NEXT MISSION</span><strong>DAY 02 / <em>COMPETE</em></strong></div>
      <span className="mission-plus" aria-hidden="true">＋</span>
    </div>
  );
}

export default function ProgramPage() {
  return (
    <section className="program-page site-section" id="program" aria-labelledby="program-heading">
      <img className="program-journey-art" src={journeyArt} alt="Pixel-art mountains and an orange expedition bus on a winding road" loading="lazy" decoding="async" />
      <span className="program-crosshair crosshair-left" aria-hidden="true" />
      <span className="program-crosshair crosshair-right" aria-hidden="true" />
      <div className="program-heading">
        <h1 id="program-heading"><span>//</span> PROGRAM.EXE</h1>
        <p>A TWO-DAY JOURNEY.<br />DIFFERENT PERSPECTIVES. A BRIGHTER YOU.</p>
      </div>
      <aside className="program-callout">SAME PEOPLE<br />NEW IDEAS<br />BIGGER TOMORROWS</aside>
      <div className="program-side-note" aria-hidden="true">IDEAS<br />PEOPLE<br />PLACES<br />A BRIGHTER<br />TOMORROW</div>
      <div className="program-days">
        {days.map((day) => <DaySchedule day={day} key={day.number} />)}
      </div>
      <MissionStatus />
    </section>
  );
}
