import React from 'react';
import './information-pages.css';

const organizer = 'IEEE Student Branch VJEC';
const address = ['Vimal Jyothi Engineering College', 'Chemperi, Kannur, Kerala, India'];
const email = 'ieeesb@vjec.ac.in';

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
  intro: "These terms apply to registrations for and participation in VYORA '26, organized by IEEE Student Branch VJEC.",
  sections: [
    {
      heading: 'REGISTRATION',
      bullets: [
        "Attendees must provide accurate and complete information while registering for VYORA '26.",
        'Registration is subject to availability and any applicable event capacity limits.',
        'Registration is considered confirmed only after successful completion of the required registration and payment process.',
        'The registration fees displayed during registration are the applicable fees for the selected registration category and options.'
      ]
    },
    {
      heading: 'ATTENDEE RESPONSIBILITIES',
      bullets: [
        'Attendees are responsible for ensuring that the information submitted during registration is accurate and complete.',
        'Participants registering under the IEEE Member category must provide a valid IEEE Membership ID. If the membership details are found to be invalid or false, the participant will be required to pay the ₹400 registration fee difference along with an additional ₹150 penalty to participate in the event.',
        "Participants must comply with the rules, safety requirements, schedules, and reasonable instructions communicated by the organizers, coordinators, volunteers, faculty members, and authorized personnel throughout VYORA '26.",
        'Participants are expected to cooperate with the organizing team and conduct themselves responsibly throughout the event.'
      ]
    },
    {
      heading: 'CODE OF CONDUCT',
      bullets: [
        "Participants are expected to maintain respectful, responsible, and appropriate behaviour throughout VYORA '26, including at the event venue, accommodation facilities, transportation, workshops, trekking or outdoor activities, and other activities associated with the event.",
        'Harassment, violence, threats, deliberate disruption, serious misconduct, damage to property, or behaviour that may endanger participants, organizers, staff, or others will not be tolerated.',
        'Participants must respect the event venue, college property, accommodation facilities, equipment, and the personal property of others.',
        'Participants must follow reasonable instructions issued by organizers and authorized personnel concerning safety, discipline, accommodation, transportation, workshops, trekking or outdoor activities, and the orderly conduct of the event.'
      ]
    },
    {
      heading: 'ALCOHOL, DRUGS & PROHIBITED SUBSTANCES',
      bullets: [
        "Possession, consumption, distribution, or use of alcohol, illegal drugs, or other prohibited substances during VYORA '26, within the event premises, accommodation facilities, transportation, or during activities organized as part of the event is strictly prohibited.",
        'Participants found violating these rules may be removed from the event immediately, subject to the circumstances and applicable institutional rules.',
        'A participant removed from the event for such misconduct will not be entitled to a refund of registration fees, accommodation charges, or other event-related payments.'
      ]
    },
    {
      heading: 'DISCIPLINARY ACTION & REMOVAL',
      paragraphs: [
        "The organizers reserve the right to remove a participant from VYORA '26 in cases of serious misconduct, violation of event rules, safety concerns, prohibited substance use, or repeated failure to comply with reasonable instructions from authorized event personnel.",
        'Where appropriate, serious violations may be reported to Vimal Jyothi Engineering College, the participant’s institution, or other appropriate authorities for further action in accordance with applicable institutional rules and procedures.',
        'Participants removed from the event for disciplinary reasons will not be eligible for a refund of registration fees, accommodation charges, or other event-related payments.'
      ]
    },
    {
      heading: 'SAFETY & EVENT ACTIVITIES',
      bullets: [
        "Participants must follow safety instructions provided for workshops, travel, trekking, outdoor activities, accommodation, and other activities conducted as part of VYORA '26.",
        'Participants must immediately inform an organizer, volunteer, or authorized personnel if they become aware of a situation that may pose a significant safety risk to themselves or others.',
        'Participants are expected to exercise reasonable care for their own safety and the safety of others while participating in event activities.'
      ]
    },
    {
      heading: 'EVENT CHANGES',
      paragraphs: [
        'Event schedules, sessions, workshops, speakers, venues, activities, transportation arrangements, and other event arrangements may be changed when reasonably necessary due to operational, safety, weather, availability, or other circumstances.'
      ]
    },
    {
      heading: 'RELATED POLICIES',
      paragraphs: [
        'Cancellations and refunds are governed by the separate Cancellation and Refund Policy. Personal information is handled according to the Privacy Policy.'
      ]
    },
    {
      heading: 'QUERIES',
      paragraphs: [
        `Questions regarding these terms or the event may be sent to ${email}.`
      ],
      email: true
    },
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
  {
    heading: 'NO CANCELLATION',
    paragraphs: [
      "Once a registration for VYORA '26 has been successfully completed and payment has been made, the registration cannot be cancelled."
    ]
  },
  {
    heading: 'NO REFUND',
    paragraphs: [
      "Registration fees paid for VYORA '26 are non-refundable. No refund will be provided if a registered participant is unable to attend the event for any reason."
    ]
  },
  {
    heading: 'PAYMENT ISSUES',
    bullets: [
      'Duplicate payments should be reported to the same email with the relevant registration and payment details.',
      'If payment has been deducted but the registration or payment status has not updated, contact the organizers with the transaction details so it can be reviewed.'
    ]
  },
  {
    heading: 'EVENT CANCELLATION',
    paragraphs: [
      'If the event is cancelled by IEEE Student Branch VJEC, affected attendees will be informed regarding the applicable refund process.'
    ]
  }
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
