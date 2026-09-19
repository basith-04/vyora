import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';

export function loginAdmin(auth, email, password, signIn = signInWithEmailAndPassword) {
  return signIn(auth, email.trim(), password);
}

export function logoutAdmin(auth, logout = signOut) {
  return logout(auth);
}

export function observeAdmin(auth, listener, observe = onAuthStateChanged) {
  return observe(auth, listener);
}
