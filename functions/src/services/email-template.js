const WORKSHOPS = Object.freeze({
  'data-science': 'Data Science and Analytics using Python',
  'ai-ml-data': 'AI / ML / Data',
  'github-ai': 'GitHub × AI',
});

const HOSTELS = Object.freeze({
  SANJOSE: 'Sanjose',
  SANTHOME: 'Santhome',
  HOLY_CROSS: 'Holy Cross',
  ALPHONSA: 'Alphonsa',
  PG_HOUSE_NEAR_COLLEGE: 'PG/House Near College',
});

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function accommodation(registration) {
  if (registration.isHosteller) return `Existing hosteller — ${HOSTELS[registration.hostel] || registration.hostel}`;
  if (registration.needsStay) return `${registration.stayType === 'AC' ? 'AC' : 'Non-AC'} accommodation requested`;
  return 'No event accommodation requested';
}

function validatedTicketUrl(baseUrl, ticketViewToken) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('PUBLIC_BASE_URL_INVALID');
  }
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('PUBLIC_BASE_URL_INVALID');
  }
  parsed.pathname = '/ticket';
  parsed.search = '';
  parsed.hash = `ticket=${encodeURIComponent(ticketViewToken)}`;
  return parsed.toString();
}

export function confirmationEmailContent({ registration, ticketViewToken, baseUrl }) {
  const ticketUrl = validatedTicketUrl(baseUrl, ticketViewToken);
  const name = escapeHtml(registration.fullName);
  const registrationId = escapeHtml(registration.registrationId);
  const category = registration.ieeeMember ? 'IEEE Member' : 'Non-IEEE Participant';
  const workshop = WORKSHOPS[registration.workshopId] || registration.workshopId;
  const stay = accommodation(registration);
  const safeUrl = escapeHtml(ticketUrl);
  const subject = "Registration Confirmed — VYORA'26";
  const html = `<!doctype html><html><body style="margin:0;background:#071c2c;color:#172934;font-family:Arial,sans-serif"><div style="max-width:620px;margin:auto;background:#fffdf5"><div style="padding:24px;background:#0a3942;color:#fffdf5"><div style="color:#46d7df;font-weight:700;letter-spacing:.08em">VYORA'26</div><h1 style="margin:8px 0 0;font-size:25px">Registration confirmed</h1></div><div style="padding:24px"><p>Hello <strong>${name}</strong>,</p><p>Your payment was verified and your registration for VYORA'26 is confirmed.</p><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:8px 0;color:#587071">Registration ID</td><td style="padding:8px 0;font-weight:700">${registrationId}</td></tr><tr><td style="padding:8px 0;color:#587071">Category</td><td style="padding:8px 0">${escapeHtml(category)}</td></tr><tr><td style="padding:8px 0;color:#587071">Workshop</td><td style="padding:8px 0">${escapeHtml(workshop)}</td></tr><tr><td style="padding:8px 0;color:#587071">Accommodation</td><td style="padding:8px 0">${escapeHtml(stay)}</td></tr><tr><td style="padding:8px 0;color:#587071">Event</td><td style="padding:8px 0">09–10 October 2026</td></tr><tr><td style="padding:8px 0;color:#587071">Venue</td><td style="padding:8px 0">Vimal Jyothi Engineering College, Chemperi</td></tr></table><p style="margin:26px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;background:#ef7b36;color:#071c2c;text-decoration:none;font-weight:700">VIEW TICKET</a></p><p>Keep your ticket QR available for event entrance and workshop check-in.</p></div><div style="padding:18px 24px;background:#f1ead7;font-size:12px;line-height:1.5">IEEE SB VJEC &amp; IEEE CIS SBC VJEC<br>Vimal Jyothi Engineering College, Chemperi</div></div></body></html>`;
  const text = `Hello ${registration.fullName},\n\nYour payment was verified and your VYORA'26 registration is confirmed.\n\nRegistration ID: ${registration.registrationId}\nCategory: ${category}\nWorkshop: ${workshop}\nAccommodation: ${stay}\nEvent: 09–10 October 2026\nVenue: Vimal Jyothi Engineering College, Chemperi\n\nView ticket: ${ticketUrl}\n\nKeep your ticket QR available for event entrance and workshop check-in.\n\nIEEE SB VJEC & IEEE CIS SBC VJEC`;
  return { subject, html, text, ticketUrl };
}
