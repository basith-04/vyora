import React from 'react';
import './information-pages.css';

const organizer = 'IEEE Student Branch VJEC';
const address = ['Vimal Jyothi Engineering College', 'Chemperi, Kannur, Kerala, India'];
const email = 'contact@ieeesbvjec.in';

const policyPages = {
  '/about-us': {
    title: 'ABOUT US',
    eyebrow: '// ABOUT VYORA.EXE',
    intro: "VYORA '26 is an event organized by IEEE Student Branch VJEC at Vimal Jyothi Engineering College.",
    sections: [{ heading: 'THE ORGANIZER', paragraphs: [`${organizer} is organizing VYORA '26 at Vimal Jyothi Engineering College, Chemperi, Kannur, Kerala, India.`, `For questions about VYORA '26, contact ${email}.`] }],
  },
  '/contact-us': {
    title: 'CONTACT US',
    eyebrow: '// CONTACT.EXE',
    intro: 'For registration, payment, refund, accommodation, event, or other VYORA-related queries, contact the organizing team.',
    sections: [{ heading: 'ORGANIZER', paragraphs: [organizer] }, { heading: 'ADDRESS', paragraphs: address }, { heading: 'EMAIL', paragraphs: [`Write to us at ${email}.`], email: true }],
  },
  '/terms-and-conditions': {
    title: 'TERMS & CONDITIONS',
    eyebrow: '// TERMS.EXE',
    intro: "These terms apply to registrations for VYORA '26, organized by IEEE Student Branch VJEC.",
    sections: [
      { heading: 'REGISTRATION', bullets: ['Attendees must provide accurate and complete information while registering for VYORA \'26.', 'Registration is subject to availability and any applicable event capacity limits.', 'Registration is considered confirmed only after successful completion of the required registration and payment process.', 'The registration fees displayed during registration are the applicable fees for the selected registration category and options.'] },
      { heading: 'ATTENDEE RESPONSIBILITIES', bullets: ['Attendees are responsible for ensuring that the information submitted during registration is correct.', 'Attendees must follow the event rules and instructions communicated by IEEE Student Branch VJEC.'] },
      { heading: 'EVENT CHANGES', paragraphs: ['Event schedules, sessions, workshops, speakers, and other arrangements may be changed when reasonably necessary.'] },
      { heading: 'RELATED POLICIES', paragraphs: ['Cancellations and refunds are governed by the separate Cancellation and Refund Policy. Personal information is handled according to the Privacy Policy.'] },
      { heading: 'QUERIES', paragraphs: [`Questions may be sent to ${email}.`], email: true },
    ],
  },
  '/privacy-policy': {
    title: 'PRIVACY POLICY',
    eyebrow: '// PRIVACY.EXE',
    intro: "This policy explains how information provided for VYORA '26 registration may be used.",
    sections: [
      { heading: 'INFORMATION WE MAY COLLECT', paragraphs: ['Depending on the registration flow, this may include your name, email address, phone number, year of study, IEEE membership information where applicable, accommodation or hostel requirements where applicable, workshop selection, and registration or payment status.'] },
      { heading: 'HOW INFORMATION IS USED', bullets: ['Processing event registration and managing attendance.', 'Managing workshop or session allocation and accommodation coordination where applicable.', 'Payment or registration verification and communication of important event information.', 'Providing attendee support and responding to event-related queries.'] },
      { heading: 'PAYMENT PROVIDERS', paragraphs: ['Where applicable, payment processing may be handled by a third-party payment provider such as Razorpay. Payment information handled directly by that provider is subject to the provider’s own policies. VYORA does not claim to store card numbers, CVVs, UPI credentials, or other payment credentials unless the implementation explicitly requires it.'] },
      { heading: 'PROTECTION AND QUESTIONS', paragraphs: ['IEEE Student Branch VJEC takes reasonable measures to protect registration information. For privacy-related questions, contact us at contact@ieeesbvjec.in.'], email: true },
    ],
  },
  '/cancellation-and-refund': {
    title: 'CANCELLATION & REFUND',
    eyebrow: '// REFUNDS.EXE',
    intro: "This policy applies to VYORA '26 registration cancellation and refund requests.",
    // TODO: If the payment provider requires a refund-processing timeline for production submission, obtain the organizer-approved timeline before publishing it.
    sections: [
      { heading: 'CANCELLATION WINDOW', paragraphs: ['Attendees may cancel their VYORA \'26 registration and request a refund until 7 days before the event begins. Cancellation and refund requests must be submitted at least 7 days before the event begins.', 'Once the registration enters the final 7-day period before the event begins, cancellations and refunds will not be entertained.'] },
      { heading: 'REFUND PROCESSING', paragraphs: ["Approved refunds will be initiated within 7 business days of approval. After initiation, the time taken for the amount to reflect in the attendee's account may depend on the original payment method and banking/payment provider."] },
      { heading: 'HOW TO REQUEST', paragraphs: [`Requests should be sent to ${email}. Please include sufficient registration details and payment information so the organizers can identify the registration.`], email: true },
      { heading: 'PAYMENT ISSUES', bullets: ['Duplicate payments should be reported to the same email with the relevant registration and payment details.', 'If payment has been deducted but the registration or payment status has not updated, contact the organizers with the transaction details so it can be reviewed.'] },
      { heading: 'EVENT CANCELLATION', paragraphs: ['If the event is cancelled by IEEE Student Branch VJEC, affected attendees will be informed regarding the applicable refund process.'] },
    ],
  },
  '/shipping-and-delivery': {
    title: 'SHIPPING & DELIVERY',
    eyebrow: '// DELIVERY.EXE',
    intro: "VYORA '26 provides event registrations, not physical goods.",
    sections: [{ heading: 'NO PHYSICAL SHIPPING', paragraphs: ['No physical product will be shipped or delivered after registration. Successful registrations are confirmed electronically.', 'Registration or payment confirmation may be displayed on the website and/or communicated through the contact details provided during registration, depending on the implementation. Event access information, instructions, and attendee information will be communicated electronically where applicable.', `Questions about registration confirmation can be sent to ${email}.`], email: true }],
  },
};

function linkedText(text, shouldLink) {
  if (!shouldLink) return text;
  const parts = text.split(email);
  return parts.reduce((result, part, index) => index === 0 ? [part] : [...result, <a key={index} href={`mailto:${email}`}>{email}</a>, part], []);
}

export function Footer() {
  const links = [['About Us', '/about-us'], ['Contact Us', '/contact-us'], ['Terms & Conditions', '/terms-and-conditions'], ['Privacy Policy', '/privacy-policy'], ['Cancellation & Refund Policy', '/cancellation-and-refund'], ['Shipping & Delivery Policy', '/shipping-and-delivery']];
  return <footer className="site-footer"><div className="site-footer-grid"><div><p className="site-footer-brand">VYORA <span>'26</span></p><p className="site-footer-organizer">Organized by {organizer}</p></div><nav aria-label="Information and policy pages"><span className="site-footer-label">// INFORMATION</span><div className="site-footer-links">{links.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</div></nav><address><span className="site-footer-label">// CONTACT</span><p>{address[0]}<br />{address[1]}</p><a href={`mailto:${email}`}>{email}</a></address></div><div className="site-footer-bottom"><span>© 2026 {organizer}</span><span>VYORA '26 / VJEC, KANNUR</span></div></footer>;
}

export function PolicyPage({ path }) {
  const page = policyPages[path] || policyPages['/about-us'];
  return <main className="policy-page" id="main-content"><div className="policy-grid-mark" aria-hidden="true" /><article className="policy-content"><span className="policy-eyebrow">{page.eyebrow}</span><h1>{page.title}</h1><p className="policy-intro">{page.intro}</p>{page.sections.map((section) => <section className="policy-section" key={section.heading}><h2>{section.heading}</h2>{section.paragraphs?.map((paragraph, index) => <p key={index}>{linkedText(paragraph, section.email)}</p>)}{section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}</section>)}</article><Footer /></main>;
}

export const informationPaths = new Set(Object.keys(policyPages));
