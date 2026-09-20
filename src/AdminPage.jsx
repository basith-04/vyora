import React, { useEffect, useMemo, useState } from 'react';
import { getAdminAuth } from './firebaseClient.js';
import { loginAdmin, logoutAdmin, observeAdmin } from './adminAuth.js';
import {
  downloadRegistrationsCsv, loadAdminProfile, loadDashboard, loadRegistration,
  loadRegistrations, retryConfirmationEmail,
} from './adminApi.js';
import {
  defaultFilters, filterRegistrations, formatDate, hostelLabels, readableStatus,
  workshopLabels,
} from './adminData.js';
import './admin.css';
import CheckInView from './CheckInView.jsx';

const statusOptions = ['PAYMENT_PENDING', 'CONFIRMED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED'];
const paymentOptions = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'];

function StatusBadge({ value, attention = false }) {
  return <span className={`admin-badge badge-${String(value || '').toLowerCase().replaceAll('_', '-')}${attention ? ' badge-attention' : ''}`}>{readableStatus(value)}</span>;
}

function Login({ auth, notice }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await loginAdmin(auth, email, password); }
    catch { setError('Sign-in failed. Check your staff email and password.'); setBusy(false); }
  };
  return (
    <main className="admin-login-shell">
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <p className="admin-kicker">VYORA '26 // STAFF CONSOLE</p>
        <h1 id="admin-login-title">Organizer sign in</h1>
        <p>Authorized administrators and coordinators only. There is no public staff signup.</p>
        {notice && <div className="admin-notice">{notice}</div>}
        {error && <div className="admin-error" role="alert">{error}</div>}
        <form onSubmit={submit}>
          <label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button type="submit" disabled={busy}>{busy ? 'AUTHENTICATING…' : 'SIGN IN'}</button>
        </form>
        <a href="/">← Return to VYORA</a>
      </section>
    </main>
  );
}

function Metric({ label, value, tone = '' }) {
  return <article className={`admin-metric ${tone}`}><span>{label}</span><strong>{value ?? 0}</strong></article>;
}

function CapacityBar({ label, occupied, capacity }) {
  const percent = capacity ? Math.min(100, (occupied / capacity) * 100) : 0;
  return (
    <div className="capacity-row">
      <div><strong>{label}</strong><span>{occupied} / {capacity}</span></div>
      <div className="capacity-track"><i style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function Overview({ dashboard }) {
  const registration = dashboard.registrations.status;
  const payment = dashboard.payments.status;
  return (
    <div className="admin-stack">
      {dashboard.payments.reconciliationRequired > 0 && (
        <section className="attention-panel" role="status">
          <strong>PAYMENT ATTENTION REQUIRED</strong>
          <span>{dashboard.payments.reconciliationRequired} registration(s) require manual reconciliation review.</span>
        </section>
      )}
      <section className="admin-panel"><div className="panel-heading"><h2>Registration overview</h2><span>{dashboard.registrations.total} historical records</span></div>
        <div className="metric-grid">
          <Metric label="Active reservations" value={dashboard.registrations.active} />
          <Metric label="Confirmed" value={registration.CONFIRMED} tone="good" />
          <Metric label="Payment pending" value={registration.PAYMENT_PENDING} />
          <Metric label="Expired" value={registration.EXPIRED} />
          <Metric label="Payment failed" value={registration.PAYMENT_FAILED} tone="warn" />
          <Metric label="Cancelled" value={registration.CANCELLED} />
        </div>
      </section>
      <section className="admin-panel"><div className="panel-heading"><h2>Attendance</h2><span>Recorded trusted check-ins</span></div><div className="metric-grid compact"><Metric label="Event checked in" value={dashboard.attendance?.event} tone="good" /><Metric label="Workshop checked in" value={dashboard.attendance?.workshop} tone="good" /></div></section>
      <section className="admin-panel"><div className="panel-heading"><h2>Operational capacity</h2><span>Counters include pending reservations</span></div>
        <CapacityBar label="Event" {...dashboard.capacity.event} />
        <CapacityBar label="First year" {...dashboard.capacity.firstYear} />
        {dashboard.workshops.map((workshop) => <CapacityBar key={workshop.id} label={workshop.name} occupied={workshop.occupied} capacity={workshop.capacity} />)}
      </section>
      <div className="admin-two-column">
        <section className="admin-panel"><div className="panel-heading"><h2>Payments</h2></div><div className="metric-grid compact">
          {paymentOptions.map((value) => <Metric key={value} label={readableStatus(value)} value={payment[value]} />)}
          <Metric label="Failed attempts" value={dashboard.payments.attempts.failed} tone="warn" />
          <Metric label="Reconciliation" value={dashboard.payments.reconciliationRequired} tone="warn" />
        </div></section>
        <section className="admin-panel"><div className="panel-heading"><h2>Participant mix</h2></div><div className="metric-grid compact">
          <Metric label="IEEE" value={dashboard.ieee.member} />
          <Metric label="Non-IEEE" value={dashboard.ieee.nonMember} />
          {[1, 2, 3, 4].map((year) => <Metric key={year} label={`Year ${year}`} value={dashboard.years[year]} />)}
        </div></section>
      </div>
    </div>
  );
}

function FilterSelect({ label, name, value, onChange, children }) {
  return <label>{label}<select name={name} value={value} onChange={onChange}><option value="">All</option>{children}</select></label>;
}

function RegistrationTable({ registrations, onOpen }) {
  if (!registrations.length) return <div className="admin-empty">No registrations match the current search and filters.</div>;
  return (
    <div className="registration-table-wrap">
      <table className="registration-table">
        <thead><tr><th>Registration</th><th>Participant</th><th>Year</th><th>Workshop</th><th>Stay</th><th>Fee</th><th>Payment</th><th>Status</th><th>Attendance</th><th>Created</th></tr></thead>
        <tbody>{registrations.map((item) => <tr key={item.registrationId} onClick={() => onOpen(item.registrationId)} tabIndex="0" onKeyDown={(event) => { if (event.key === 'Enter') onOpen(item.registrationId); }}>
          <td data-label="Registration"><strong>{item.registrationId}</strong>{item.paymentReconciliationRequired && <span className="table-attention">ATTENTION</span>}</td>
          <td data-label="Participant"><strong>{item.fullName}</strong><small>{item.email}<br />{item.phone}</small></td>
          <td data-label="Year">Year {item.year}<small>{item.ieeeMember ? 'IEEE' : 'Non-IEEE'}</small></td>
          <td data-label="Workshop">{workshopLabels[item.workshopId] || item.workshopId}</td>
          <td data-label="Stay">{item.isHosteller ? hostelLabels[item.hostel] || 'Hosteller' : item.needsStay ? `${readableStatus(item.stayType)} requested` : 'No stay'}</td>
          <td data-label="Fee">₹{item.totalFee}</td>
          <td data-label="Payment"><StatusBadge value={item.paymentStatus} /></td>
          <td data-label="Status"><StatusBadge value={item.registrationStatus} /></td>
          <td data-label="Attendance"><small>Event: {item.attendance?.event ? '✓' : '—'}<br />Workshop: {item.attendance?.workshop ? '✓' : '—'}</small></td>
          <td data-label="Created">{formatDate(item.createdAt)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

function RegistrationsView({ registrations, onOpen }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ ...defaultFilters });
  const result = useMemo(() => filterRegistrations(registrations, search, filters), [registrations, search, filters]);
  const change = (event) => setFilters((current) => ({ ...current, [event.target.name]: event.target.value }));
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  return <section className="admin-panel registrations-panel">
    <div className="panel-heading"><div><h2>Registrations</h2><span>{result.length} of {registrations.length} records</span></div><button className="secondary-button" type="button" onClick={() => { setSearch(''); setFilters({ ...defaultFilters }); }} disabled={!search && !activeFilterCount}>Clear filters</button></div>
    <div className="admin-search"><label>Search registrations<input type="search" placeholder="ID, name, email or phone" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
    <div className="admin-filters">
      <FilterSelect label="Registration" name="registrationStatus" value={filters.registrationStatus} onChange={change}>{statusOptions.map((item) => <option key={item}>{item}</option>)}</FilterSelect>
      <FilterSelect label="Payment" name="paymentStatus" value={filters.paymentStatus} onChange={change}>{paymentOptions.map((item) => <option key={item}>{item}</option>)}</FilterSelect>
      <FilterSelect label="Year" name="year" value={filters.year} onChange={change}>{[1, 2, 3, 4].map((item) => <option key={item} value={item}>Year {item}</option>)}</FilterSelect>
      <FilterSelect label="IEEE" name="ieee" value={filters.ieee} onChange={change}><option value="true">IEEE</option><option value="false">Non-IEEE</option></FilterSelect>
      <FilterSelect label="Workshop" name="workshopId" value={filters.workshopId} onChange={change}>{Object.entries(workshopLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</FilterSelect>
      <FilterSelect label="Hosteller" name="hosteller" value={filters.hosteller} onChange={change}><option value="true">Hosteller</option><option value="false">Non-hosteller</option></FilterSelect>
      <FilterSelect label="Hostel" name="hostel" value={filters.hostel} onChange={change}>{Object.entries(hostelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</FilterSelect>
      <FilterSelect label="Stay" name="stay" value={filters.stay} onChange={change}><option value="true">Needs Stay</option><option value="false">No Stay</option></FilterSelect>
      <FilterSelect label="Stay type" name="stayType" value={filters.stayType} onChange={change}><option value="AC">AC</option><option value="NON_AC">Non-AC</option></FilterSelect>
      <FilterSelect label="Reconciliation" name="reconciliation" value={filters.reconciliation} onChange={change}><option value="true">Required</option><option value="false">Not Required</option></FilterSelect>
      <FilterSelect label="Event check-in" name="eventCheckin" value={filters.eventCheckin} onChange={change}><option value="true">Checked in</option><option value="false">Not checked in</option></FilterSelect>
      <FilterSelect label="Workshop check-in" name="workshopCheckin" value={filters.workshopCheckin} onChange={change}><option value="true">Checked in</option><option value="false">Not checked in</option></FilterSelect>
    </div>
    <RegistrationTable registrations={result} onOpen={onOpen} />
  </section>;
}

function WorkshopView({ dashboard, registrations, onOpen }) {
  return <div className="summary-grid">{dashboard.workshops.map((workshop) => {
    const participants = registrations.filter((item) => item.workshopId === workshop.id && ['PAYMENT_PENDING', 'CONFIRMED'].includes(item.registrationStatus));
    return <section className="admin-panel" key={workshop.id}><div className="panel-heading"><div><h2>{workshop.name}</h2><span>{workshop.occupied} / {workshop.capacity} operationally occupied · {workshop.confirmed} confirmed</span></div></div>
      <div className="summary-list">{participants.length ? participants.map((item) => <button key={item.registrationId} type="button" onClick={() => onOpen(item.registrationId)}><span><strong>{item.fullName}</strong><small>{item.registrationId} · Year {item.year}</small></span><StatusBadge value={item.registrationStatus} /></button>) : <div className="admin-empty">No active participants.</div>}</div>
    </section>;
  })}</div>;
}

function AccommodationView({ dashboard, registrations, onOpen }) {
  const active = registrations.filter((item) => ['PAYMENT_PENDING', 'CONFIRMED'].includes(item.registrationStatus) && (item.isHosteller || item.needsStay));
  return <div className="admin-stack"><section className="admin-panel"><div className="panel-heading"><h2>Accommodation summary</h2><span>Active reservations and confirmed registrations</span></div><div className="metric-grid">
    <Metric label="Existing hostellers" value={dashboard.accommodation.activeHostellers} />
    <Metric label="Non-hostellers" value={dashboard.accommodation.activeNonHostellers} />
    <Metric label="Stay requested" value={dashboard.accommodation.activeStayRequests} />
    <Metric label="AC requested" value={dashboard.accommodation.activeAcRequests} />
    <Metric label="Non-AC requested" value={dashboard.accommodation.activeNonAcRequests} />
    {Object.entries(hostelLabels).map(([id, label]) => <Metric key={id} label={label} value={dashboard.accommodation.hostels[id]} />)}
  </div></section><section className="admin-panel"><div className="panel-heading"><h2>Accommodation participants</h2><span>{active.length} active records</span></div><div className="summary-list">{active.map((item) => <button key={item.registrationId} type="button" onClick={() => onOpen(item.registrationId)}><span><strong>{item.fullName}</strong><small>{item.isHosteller ? hostelLabels[item.hostel] : `${readableStatus(item.stayType)} stay requested`} · {item.registrationId}</small></span><StatusBadge value={item.registrationStatus} /></button>)}</div></section></div>;
}

function Detail({ registration, loading, onClose, onRetryEmail, emailRetrying }) {
  return <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="registration-detail-title">
    <button className="detail-close" type="button" aria-label="Close registration detail" onClick={onClose}>×</button>
    {loading ? <div className="admin-loading">Loading registration…</div> : registration && <>
      <p className="admin-kicker">REGISTRATION DETAIL</p><h2 id="registration-detail-title">{registration.fullName}</h2><p className="detail-id">{registration.registrationId}</p>
      {registration.paymentReconciliationRequired && <div className="attention-panel"><strong>RECONCILIATION REQUIRED</strong><span>Review this payment outside the dashboard. No capacity or status change has been made.</span></div>}
      <div className="detail-section"><h3>Participant</h3><dl><dt>Email</dt><dd>{registration.email}</dd><dt>Phone</dt><dd>{registration.phone}</dd><dt>Year</dt><dd>Year {registration.year}</dd></dl></div>
      <div className="detail-section"><h3>IEEE & workshop</h3><dl><dt>Member</dt><dd>{registration.ieeeMember ? 'IEEE' : 'Non-IEEE'}</dd><dt>Membership ID</dt><dd>{registration.ieeeMembershipId || '—'}</dd><dt>Workshop</dt><dd>{workshopLabels[registration.workshopId]}</dd></dl></div>
      <div className="detail-section"><h3>Accommodation</h3><dl><dt>Hosteller</dt><dd>{registration.isHosteller ? 'Yes' : 'No'}</dd><dt>Hostel</dt><dd>{hostelLabels[registration.hostel] || '—'}</dd><dt>Needs stay</dt><dd>{registration.needsStay ? 'Yes' : 'No'}</dd><dt>Stay type</dt><dd>{readableStatus(registration.stayType)}</dd></dl></div>
      <div className="detail-section"><h3>Pricing & payment</h3><dl><dt>Base fee</dt><dd>₹{registration.baseFee}</dd><dt>Stay fee</dt><dd>₹{registration.stayFee}</dd><dt>Total</dt><dd>₹{registration.totalFee}</dd><dt>Payment</dt><dd><StatusBadge value={registration.paymentStatus} /></dd><dt>Registration</dt><dd><StatusBadge value={registration.registrationStatus} /></dd><dt>Razorpay order</dt><dd className="breakable">{registration.razorpayOrderId || '—'}</dd><dt>Razorpay payment</dt><dd className="breakable">{registration.razorpayPaymentId || registration.payment?.razorpayPaymentId || '—'}</dd><dt>Gateway status</dt><dd>{readableStatus(registration.payment?.status)}</dd><dt>Gateway amount</dt><dd>{registration.payment?.amount != null ? `₹${(registration.payment.amount / 100).toFixed(2)} ${registration.payment.currency || ''}` : '—'}</dd><dt>Reconciliation</dt><dd>{registration.paymentReconciliationRequired ? 'Required' : 'Not required'}</dd><dt>Reason</dt><dd>{readableStatus(registration.payment?.reconciliationReason)}</dd><dt>Payment completed</dt><dd>{formatDate(registration.paymentCompletedAt)}</dd></dl></div>
      <div className="detail-section"><h3>Reservation timeline</h3><dl><dt>Created</dt><dd>{formatDate(registration.createdAt)}</dd><dt>Reservation expiry</dt><dd>{formatDate(registration.seatReservationExpiresAt)}</dd><dt>Capacity released</dt><dd>{registration.capacityReleased ? 'Yes' : 'No'}</dd><dt>Confirmed</dt><dd>{formatDate(registration.confirmedAt)}</dd><dt>Expired</dt><dd>{formatDate(registration.expiredAt)}</dd></dl></div>
      <div className="detail-section"><h3>Attendance</h3><dl><dt>Event check-in</dt><dd>{formatDate(registration.attendance?.event?.checkedInAt)}</dd><dt>Event staff</dt><dd>{registration.attendance?.event?.checkedInByName || registration.attendance?.event?.checkedInBy || '—'}</dd><dt>Workshop check-in</dt><dd>{formatDate(registration.attendance?.workshop?.checkedInAt)}</dd><dt>Workshop</dt><dd>{workshopLabels[registration.attendance?.workshop?.workshopId] || '—'}</dd><dt>Workshop staff</dt><dd>{registration.attendance?.workshop?.checkedInByName || registration.attendance?.workshop?.checkedInBy || '—'}</dd></dl></div>
      <div className="detail-section"><h3>Confirmation email</h3><dl><dt>Status</dt><dd><StatusBadge value={registration.confirmationEmail?.status || 'PENDING'} /></dd><dt>Sent</dt><dd>{formatDate(registration.confirmationEmail?.sentAt)}</dd><dt>Last attempt</dt><dd>{formatDate(registration.confirmationEmail?.lastAttemptAt)}</dd><dt>Attempts</dt><dd>{registration.confirmationEmail?.attempts ?? 0} / 3</dd><dt>Last error</dt><dd>{readableStatus(registration.confirmationEmail?.lastErrorCode)}</dd></dl>{registration.registrationStatus === 'CONFIRMED' && ['PENDING', 'FAILED', 'SENDING'].includes(registration.confirmationEmail?.status || 'PENDING') && registration.confirmationEmail?.attempts < 3 && <button className="email-retry-button" type="button" disabled={emailRetrying} onClick={() => onRetryEmail(registration.registrationId)}>{emailRetrying ? 'RETRYING…' : 'RETRY CONFIRMATION EMAIL'}</button>}</div>
    </>}
  </aside></div>;
}

export default function AdminPage() {
  const [auth, setAuth] = useState(null);
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [view, setView] = useState(() => window.location.pathname.replace(/\/+$/, '') === '/admin/check-in' ? 'checkin' : 'overview');
  const [state, setState] = useState('authenticating');
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [emailRetrying, setEmailRetrying] = useState(false);

  useEffect(() => {
    let instance;
    try { instance = getAdminAuth(); setAuth(instance); }
    catch (error) { setState('configuration-error'); setMessage(error.message); return undefined; }
    return observeAdmin(instance, (current) => setUser(current));
  }, []);

  const refresh = async () => {
    if (!auth?.currentUser) return;
    setState('loading'); setMessage('');
    try {
      const [nextProfile, nextDashboard, nextRegistrations] = await Promise.all([
        loadAdminProfile(auth), loadDashboard(auth), loadRegistrations(auth),
      ]);
      setProfile(nextProfile); setDashboard(nextDashboard); setRegistrations(nextRegistrations.registrations); setState('ready');
    } catch (error) {
      if (error.status === 403) setState('unauthorized');
      else if (error.status === 401) { setMessage('Your session expired. Please sign in again.'); await logoutAdmin(auth); setState('authenticating'); }
      else { setMessage(error.message); setState('error'); }
    }
  };

  useEffect(() => {
    if (user === undefined) return;
    if (!user) { setProfile(null); setDashboard(null); setRegistrations([]); setState('signed-out'); return; }
    refresh();
  }, [user]); // Firebase auth state is the trigger; refresh deliberately owns API state.

  const openDetail = async (registrationId) => {
    setDetail({ registrationId }); setDetailLoading(true);
    try { setDetail(await loadRegistration(auth, registrationId)); }
    catch (error) { setMessage(error.message); setDetail(null); }
    finally { setDetailLoading(false); }
  };

  const exportCsv = async () => {
    setExporting(true); setMessage('');
    try {
      const blob = await downloadRegistrationsCsv(auth);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'vyora-26-registrations.csv'; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { setMessage(`Export failed: ${error.message}`); }
    finally { setExporting(false); }
  };
  const selectView = (nextView) => {
    setView(nextView);
    const path = nextView === 'checkin' ? '/admin/check-in' : '/admin';
    if (window.location.pathname !== path) window.history.pushState(window.history.state, '', path);
  };
  const retryEmail = async (registrationId) => {
    setEmailRetrying(true); setMessage('');
    try {
      const result = await retryConfirmationEmail(auth, registrationId);
      setMessage(result.outcome === 'SENT' ? 'Confirmation email sent.' : `Confirmation email status: ${result.outcome}.`);
      setDetail(await loadRegistration(auth, registrationId));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setEmailRetrying(false);
    }
  };

  if (state === 'configuration-error') return <main className="admin-center-state"><h1>Admin configuration required</h1><p>{message}</p></main>;
  if (state === 'authenticating' || user === undefined) return <main className="admin-center-state"><div className="admin-spinner" /><p>Authenticating staff session…</p></main>;
  if (!user || state === 'signed-out') return <Login auth={auth} notice={message} />;
  if (state === 'unauthorized') return <main className="admin-center-state"><h1>Access not authorized</h1><p>Your Firebase account is valid, but it is not an active VYORA admin or coordinator.</p><button onClick={() => logoutAdmin(auth)}>Sign out</button></main>;
  if (state === 'loading') return <main className="admin-center-state"><div className="admin-spinner" /><p>Loading protected event data…</p></main>;
  if (state === 'error') return <main className="admin-center-state"><h1>Dashboard unavailable</h1><p>{message}</p><div><button onClick={refresh}>Retry</button> <button onClick={() => logoutAdmin(auth)}>Sign out</button></div></main>;

  return <div className="admin-app">
    <header className="admin-header"><div><p className="admin-kicker">VYORA '26 // OPERATIONS</p><h1>Staff Dashboard</h1></div><div className="admin-identity"><span>{profile.name}<small>{profile.role} · {profile.email}</small></span><button className="secondary-button" onClick={refresh}>Refresh</button><button onClick={() => logoutAdmin(auth)}>Logout</button></div></header>
    <nav className="admin-tabs" aria-label="Admin sections">{[['overview', 'Overview'], ['registrations', 'Registrations'], ['workshops', 'Workshops'], ['accommodation', 'Accommodation'], ['checkin', 'Check-in']].map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => selectView(id)}>{label}</button>)}<button className="export-button" onClick={exportCsv} disabled={exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</button></nav>
    {message && <div className="admin-page-message" role="alert">{message}<button aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}
    <main className="admin-content">
      {view === 'overview' && <Overview dashboard={dashboard} />}
      {view === 'registrations' && <RegistrationsView registrations={registrations} onOpen={openDetail} />}
      {view === 'workshops' && <WorkshopView dashboard={dashboard} registrations={registrations} onOpen={openDetail} />}
      {view === 'accommodation' && <AccommodationView dashboard={dashboard} registrations={registrations} onOpen={openDetail} />}
      {view === 'checkin' && <CheckInView auth={auth} />}
    </main>
    {detail && <Detail registration={detail.registrationId && !detail.fullName ? null : detail} loading={detailLoading} onClose={() => setDetail(null)} onRetryEmail={retryEmail} emailRetrying={emailRetrying} />}
  </div>;
}
