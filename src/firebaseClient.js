import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

const env = import.meta.env || {};
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

let auth;
let emulatorConnected = false;

export function getAdminAuth() {
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Firebase client configuration is missing: ${missing.join(', ')}`);
  const app = getApps().length ? getApp() : initializeApp(config);
  auth ||= getAuth(app);
  if (env.VITE_USE_FIREBASE_AUTH_EMULATOR === 'true' && !emulatorConnected) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    emulatorConnected = true;
  }
  return auth;
}
