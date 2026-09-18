import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { legacySectionRoutes } from './siteNavigation.js';

const legacySection = legacySectionRoutes[window.location.pathname.replace(/\/+$/, '')];
if (legacySection) window.history.replaceState(window.history.state, '', `/#${legacySection}`);

createRoot(document.getElementById('root')).render(<App />);
