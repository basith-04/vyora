import React from 'react';

export default function ParticipantSearch({ search, setSearch, matches, busy, onSelect, action, showEmail = false }) {
  return <>
    <div className="admin-search"><label>Search participant by name<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Participant name" disabled={busy} /></label></div>
    {search.trim() && <div className="summary-list">{matches.length ? matches.map((item) => <button type="button" key={item.registrationId} onClick={() => onSelect(item)} disabled={busy}><span><strong>{item.fullName}</strong><small>{item.registrationId} · {showEmail && `${item.email} · `}Year {item.year} · {item.department || '—'} {item.class || ''}</small></span><span>{action}</span></button>) : <div className="admin-empty">No confirmed participants found.</div>}</div>}
  </>;
}
