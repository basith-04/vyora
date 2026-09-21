import React from 'react';
import { REGISTRATION_CLOSED_LABEL } from './registrationAvailability.js';
import './registration.css';

export default function RegistrationClosedPage() {
  return (
    <main className="registration-page" id="main-content">
      <div className="registration-container registration-closed-container">
        <section className="registration-terminal registration-success registration-closed-message" role="status" aria-labelledby="registration-closed-heading">
          <span>// REGISTRATION.EXE — STATUS</span>
          <div className="registration-closed-mark" aria-hidden="true">×</div>
          <h1 id="registration-closed-heading">{REGISTRATION_CLOSED_LABEL}</h1>
          <p>Registration for VYORA '26 has officially closed. Thank you for your interest.</p>
          <div className="registration-success-actions">
            <a href="/">BACK TO HOME →</a>
          </div>
        </section>
      </div>
    </main>
  );
}
