import React, { useState } from 'react';
import landscape from '../assets/tracks-landscape-strip.png';
import adventurer from '../assets/vyora-adventurer-standing.png';
import './tracks.css';

const tracks = [
  {
    number: '01',
    tone: 'orange',
    title: 'DATA SCIENCE AND ANALYTICS USING PYTHON',
    titleLines: ['DATA SCIENCE AND', 'ANALYTICS USING PYTHON'],
    descriptor: 'DATA / ANALYSIS / VISUALISATION',
    speakerLabel: 'SPEAKER',
    speakers: ['Sreeram M R'],
    affiliation: 'Entri App',
    action: 'INSPECT TRACK',
  },
  {
    number: '02',
    tone: 'blue',
    title: 'AI / ML / DATA',
    titleLines: ['AI / ML / DATA'],
    descriptor: 'MODELS / DATA / INTELLIGENCE',
    speakerLabel: 'SPEAKERS',
    speakers: ['Abhinav I', 'Usmanul Faris K S', 'Abhiram M S'],
    affiliation: 'S7 ADS A',
    action: 'INSPECT TRACK',
  },
  {
    number: '03',
    tone: 'green',
    title: 'GITHUB × AI',
    titleLines: ['GITHUB × AI'],
    descriptor: 'CODE / COLLABORATION / AI',
    speakerLabel: 'SPEAKERS',
    speakers: ['Josin Joseph', 'Samanway T K'],
    affiliation: 'S7 ADS A',
    action: 'LOAD MODULE',
  },
];

function DataDiagram() {
  return (
    <div className="data-diagram" aria-hidden="true">
      <svg viewBox="0 0 350 112" preserveAspectRatio="xMidYMid meet">
        <g fill="none" stroke="#69b7d6" strokeWidth="1.3">
          <rect x="17" y="4" width="69" height="50" />
          <rect x="128" y="4" width="91" height="50" />
          <rect x="259" y="4" width="69" height="50" />
          <path d="M90 29h29m-7-4 7 4-7 4M221 29h29m-7-4 7 4-7 4" />
        </g>
        <g fill="#4ad7cf"><rect x="26" y="40" width="7" height="8" /><rect x="38" y="31" width="7" height="17" /><rect x="50" y="25" width="7" height="23" /><rect x="62" y="19" width="7" height="29" /><rect x="74" y="13" width="7" height="35" /></g>
        <g fill="none" stroke="#33bedb" strokeWidth="2"><path d="M267 44 281 31l13 7 11-14 12-8"/><path d="m311 16 6 0-1 6"/></g>
        <g fill="#2a92dc"><path d="M168 10h21q8 0 8 8v11h-31q-7 0-7 7v6h-8q-7 0-7-8V22q0-8 8-8h16z" /><circle cx="183" cy="17" r="2" fill="#071e2e" /></g>
        <g fill="#ffd34b"><path d="M179 47h-20q-8 0-8-8V28h31q7 0 7-7v-5h8q8 0 8 8v12q0 8-8 8h-18z" /><circle cx="167" cy="40" r="2" fill="#071e2e" /></g>
        <g strokeWidth="1.3"><rect x="15" y="70" width="93" height="37" fill="#071e2e" stroke="#c9dce1"/><rect x="128" y="70" width="92" height="37" fill="#fff0ca" stroke="#ff9b37"/><rect x="241" y="70" width="94" height="37" fill="#071e2e" stroke="#c9dce1"/></g>
        <g fill="#f1eee6" fontFamily="IBM Plex Mono, monospace" fontSize="14" textAnchor="middle"><text x="61" y="94">DATA</text><text x="288" y="94">INSIGHTS</text></g>
        <text x="174" y="94" fill="#061a29" fontFamily="IBM Plex Mono, monospace" fontSize="14" fontWeight="700" textAnchor="middle">PYTHON</text>
        <g fill="none" stroke="#ffbd4a" strokeWidth="1.4"><path d="M110 88h15m-5-4 5 4-5 4M239 88h-16m5-4-5 4 5 4" /></g>
      </svg>
      <div className="track-one-facts"><span><b aria-hidden="true">▦</b> October 10</span><span><b aria-hidden="true">◆</b> VJEC</span></div>
    </div>
  );
}

const scatterPoints = [
  [26,123],[34,107],[42,111],[49,92],[52,119],[58,83],[64,101],[69,88],[74,112],[78,71],
  [82,92],[87,64],[91,84],[96,71],[100,95],[104,51],[109,75],[113,61],[117,43],[121,68],
  [126,55],[132,37],[137,51],[140,29],[147,40],[151,23],[63,129],[90,117],[115,98],[143,82],
];

function ModelDiagram() {
  const left = [[187,20],[187,48],[187,76],[187,104],[187,132]];
  const middle = [[265,20],[265,48],[265,76],[265,104],[265,132]];
  const right = [[326,48],[326,104]];
  return (
    <svg className="model-diagram" viewBox="0 0 345 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g fill="none" stroke="#e6eff0" strokeWidth="1.3"><path d="M15 132V11m-4 6 4-6 4 6M15 132h135m-6-4 6 4-6 4"/><path d="M20 128 135 31" stroke="#bce7e7"/></g>
      <g fill="#ffcb79">{scatterPoints.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i%5===0?1.4:1} />)}</g>
      <g fill="none" stroke="#2472b3" strokeWidth=".85" opacity=".76">{left.flatMap(([x1,y1],i)=>middle.map(([x2,y2],j)=><line key={`a${i}-${j}`} x1={x1} y1={y1} x2={x2} y2={y2} />))}{middle.flatMap(([x1,y1],i)=>right.map(([x2,y2],j)=><line key={`b${i}-${j}`} x1={x1} y1={y1} x2={x2} y2={y2} />))}</g>
      <g fill="#0c2436" stroke="#e9f3f2" strokeWidth="2">{[...left,...middle,...right].map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r="8" />)}</g>
    </svg>
  );
}

function GitDiagram() {
  return (
    <svg className="git-diagram" viewBox="0 0 350 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g fill="none" stroke="#7db8c5" strokeWidth="1"><path d="M18 130V13m-4 5 4-5 4 5M18 130h194"/><path d="M18 91h191M18 38h191" opacity=".32"/></g>
      <g fill="none" strokeWidth="1.4"><path d="M18 91h44q14 0 21-20l12-20q7-12 18-12h107" stroke="#ffbe54"/><path d="M18 91h40q25 0 36 30h126" stroke="#6de2a6"/><path d="M18 91h81q28 0 43 0h78" stroke="#3e9ce5"/><path d="M112 39h108" stroke="#f7594c"/><path d="M145 91q12-21 15-21h60" stroke="#3e9ce5"/></g>
      <g stroke="#092536" strokeWidth="1">{[[18,91,'#66dfab'],[18,130,'#66dfab'],[62,91,'#ffc75e'],[93,58,'#ffc75e'],[98,120,'#66dfab'],[140,91,'#3e9ce5'],[160,70,'#3e9ce5'],[180,39,'#fa5a4c'],[220,39,'#fa5a4c'],[220,130,'#ffc75e']].map(([cx,cy,fill],i)=><circle key={i} cx={cx} cy={cy} r="5.6" fill={fill} />)}</g>
      <g fontFamily="IBM Plex Mono, monospace" fontSize="14" fill="#e7eeee"><circle cx="259" cy="38" r="6" fill="#66dfab"/><text x="270" y="43">main</text><circle cx="259" cy="67" r="6" fill="#3e9ce5"/><text x="270" y="72">feature</text><circle cx="259" cy="96" r="6" fill="#fa5a4c"/><text x="270" y="101">debug</text><circle cx="259" cy="125" r="6" fill="#ffc75e"/><text x="270" y="130">improve</text></g>
    </svg>
  );
}

function TrackWindow({ track, selected, onSelect }) {
  return (
    <article id={`track-${track.number}`} className={`track-window track-window-${track.tone} ${selected ? 'is-selected' : ''}`} aria-labelledby={`track-${track.number}-title`}>
      <div className="track-window-bar"><span className="track-window-glyph" aria-hidden="true">▶</span><span>AIDEX / {track.number}</span><span className="track-window-controls" aria-hidden="true">─ □ ×</span></div>
      <div className="track-window-body">
        <div className="track-window-lead">
          <h3 id={`track-${track.number}-title`}>{track.titleLines.map((line)=><span key={line}>{line}</span>)}</h3>
          <p>{track.descriptor}</p>
        </div>
        <div className="track-window-visual">{track.number === '01' ? <DataDiagram /> : track.number === '02' ? <ModelDiagram /> : <GitDiagram />}</div>
        <div className="track-window-speakers"><span>{track.speakerLabel}</span>{track.speakers.map((speaker)=><strong key={speaker}>{speaker}</strong>)}<small>{track.affiliation}</small></div>
        <button className="track-window-action" type="button" aria-pressed={selected} onClick={onSelect}>{track.action} <span aria-hidden="true">→</span></button>
      </div>
    </article>
  );
}

function TrackSelector({ selected, onSelect }) {
  return (
    <div className="track-selector" role="group" aria-label="Select an AIDEX workshop">
      {tracks.map((track)=><button key={track.number} type="button" className={`track-selector-item selector-${track.tone}`} aria-label={`Select track ${track.number}: ${track.title}`} aria-pressed={selected === track.number} onClick={()=>onSelect(track.number)}><span>{track.number}</span><i /></button>)}
    </div>
  );
}

export default function TracksPage() {
  const [selectedTrack, setSelectedTrack] = useState('01');

  function selectTrack(number) {
    setSelectedTrack(number);
    if (window.matchMedia('(max-width: 760px)').matches) {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById(`track-${number}`)?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    }
  }

  return (
    <section className="tracks-page site-section" id="tracks" aria-labelledby="tracks-heading">
      <span className="tracks-crosshair tracks-crosshair-left" aria-hidden="true" />
      <span className="tracks-crosshair tracks-crosshair-right" aria-hidden="true" />
      <div className="tracks-top">
        <div className="tracks-heading"><p>// TRACKS.EXE</p><h1 id="tracks-heading">CHOOSE YOUR PATH.</h1></div>
        <div className="aidex-identity"><h2>AIDEX</h2><p>ADVANCING INTELLIGENCE,<br />DEVELOPMENT, ENGAGEMENT<br />&amp; EXCELLENCE</p></div>
        <aside className="aidex-access" aria-label="AIDEX workshop access"><strong>AIDEX WORKSHOP SERIES</strong><span>03 WORKSHOPS</span><div><b>WORKSHOP ACCESS: FREE</b><b>NO ADDITIONAL FEE</b></div></aside>
      </div>
      <div className="tracks-side-note" aria-hidden="true">IDEAS<br />PEOPLE<br />PLACES<br />A BRIGHTER<br />TOMORROW</div>
      <section className="tracks-modules" aria-label="AIDEX workshops">
        {tracks.map((track)=><TrackWindow key={track.number} track={track} selected={selectedTrack === track.number} onSelect={()=>selectTrack(track.number)} />)}
      </section>
      <div className="tracks-expedition">
        <img className="tracks-landscape" src={landscape} alt="Layered pixel-art mountains and forest in the VYORA expedition world" loading="lazy" decoding="async" />
        <img className="tracks-adventurer" src={adventurer} alt="VYORA adventurer overlooking the mountains" loading="lazy" decoding="async" />
        <div className="tracks-dialogue">NOT JUST TECH.<br />A STRONGER COMMUNITY.<span aria-hidden="true">›</span></div>
        <TrackSelector selected={selectedTrack} onSelect={selectTrack} />
        <div className="tracks-footer-meta">VYORA '26<br />VJEC, KANNUR</div>
      </div>
    </section>
  );
}
