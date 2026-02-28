import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  GoogleAuthProvider,
  OAuthProvider,
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  linkWithPopup,
  signInWithPopup,
  linkWithRedirect,
  signInWithRedirect,
  getRedirectResult,
  linkWithCredential,
  signInWithCredential,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut as _signOut,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCpoz7BNMxTnpVPUJAPaMdgOPXTg2BSsZo",
  authDomain: "mylittleprojects-3ebd5.firebaseapp.com",
  projectId: "mylittleprojects-3ebd5",
  storageBucket: "mylittleprojects-3ebd5.firebasestorage.app",
  messagingSenderId: "349781789746",
  appId: "1:349781789746:web:2785e732025910ef48c02b",
  measurementId: "G-GFYZXZ4XC8",
};

const existingApp = getApps().length ? getApp() : null;
const app = existingApp ?? initializeApp(firebaseConfig);
export const db = existingApp
  ? getFirestore(app)
  : initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
export const auth = getAuth(app);

/**
 * Redirect auth avoids popup blockers on mobile/PWA and avoids COOP popup
 * warnings on deployed static hosts that do not set popup-friendly headers.
 */
function shouldUseRedirectAuth() {
  const hostname = window.location.hostname;
  const isLocalDev = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    window.matchMedia('(display-mode: standalone)').matches ||
    !!window.navigator.standalone ||
    !isLocalDev
  );
}

/**
 * Wait for auth state to resolve.
 * By default this falls back to anonymous auth so the app can always work.
 */
export function waitForAuth({ allowAnonymous = true } = {}) {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (user) {
        resolve(user.uid);
      } else if (!allowAnonymous) {
        resolve(null);
      } else {
        try {
          const cred = await signInAnonymously(auth);
          resolve(cred.user.uid);
        } catch (err) {
          reject(err);
        }
      }
    });
  });
}

/**
 * Uses redirect auth in production/mobile and only keeps popup auth for local
 * desktop development. Returns null when a redirect has just been initiated.
 */
export async function signInWithGoogle() {
  return _signInWithProvider(new GoogleAuthProvider());
}

/**
 * Apple sign-in — same popup/redirect logic as Google.
 * NOTE: requires Apple Developer account + Services ID configured in Firebase Console.
 */
export async function signInWithApple() {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  return _signInWithProvider(provider);
}

async function _signInWithProvider(provider) {
  const user = auth.currentUser;
  if (shouldUseRedirectAuth()) {
    // Redirect flow — page navigates away; handleRedirectResult() completes sign-in on return
    if (user?.isAnonymous) {
      await linkWithRedirect(user, provider);
    } else {
      await signInWithRedirect(auth, provider);
    }
    return null; // page is navigating, nothing more to do here
  }

  // Popup flow (desktop)
  if (user?.isAnonymous) {
    try {
      return (await linkWithPopup(user, provider)).user;
    } catch (err) {
      if (err.code === 'auth/credential-already-in-use') {
        return (await signInWithCredential(auth, err.credential)).user;
      }
      throw err;
    }
  }
  return (await signInWithPopup(auth, provider)).user;
}

/**
 * Call once on app startup (in the init useEffect).
 * Handles the return from a Google/Apple redirect sign-in.
 * Returns the signed-in user, or null if no redirect was pending.
 */
export async function handleRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } catch (err) {
    if (err.code === 'auth/credential-already-in-use') {
      // The Google/Apple account already has a Firebase account — sign into it
      return (await signInWithCredential(auth, err.credential)).user;
    }
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
      return null; // User cancelled — treat as no-op
    }
    throw err;
  }
}

/**
 * Sign in with email + password.
 * Links anonymous account if this is the first sign-in on this device.
 */
export async function signInWithEmail(email, password) {
  const user = auth.currentUser;
  if (user?.isAnonymous) {
    const credential = EmailAuthProvider.credential(email, password);
    try {
      return (await linkWithCredential(user, credential)).user;
    } catch (err) {
      if (err.code === 'auth/credential-already-in-use' || err.code === 'auth/email-already-in-use') {
        return (await signInWithEmailAndPassword(auth, email, password)).user;
      }
      throw err;
    }
  }
  return (await signInWithEmailAndPassword(auth, email, password)).user;
}

/**
 * Create a new email + password account.
 * Links the anonymous account to preserve existing data.
 */
export async function createEmailAccount(email, password) {
  const user = auth.currentUser;
  if (user?.isAnonymous) {
    const credential = EmailAuthProvider.credential(email, password);
    return (await linkWithCredential(user, credential)).user;
  }
  return (await createUserWithEmailAndPassword(auth, email, password)).user;
}

/**
 * Send a magic (passwordless) sign-in link to the given email.
 * NOTE: Enable "Email link (passwordless sign-in)" in Firebase Console →
 * Authentication → Sign-in methods → Email/Password.
 */
export async function sendMagicLink(email) {
  const actionCodeSettings = {
    url: window.location.origin,
    handleCodeInApp: true,
  };
  await sendSignInLinkToEmail(auth, email, actionCodeSettings);
  localStorage.setItem('emailForSignIn', email);
}

/**
 * Complete magic link sign-in when the user opens the link.
 * Call on app start — no-op if the URL is not a magic link.
 */
export async function completeMagicLinkSignIn() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return null;
  const email = localStorage.getItem('emailForSignIn');
  if (!email) return null;

  const user = auth.currentUser;
  if (user?.isAnonymous) {
    const credential = EmailAuthProvider.credentialWithLink(email, window.location.href);
    try {
      const result = await linkWithCredential(user, credential);
      localStorage.removeItem('emailForSignIn');
      window.history.replaceState({}, document.title, window.location.pathname);
      return result.user;
    } catch (err) {
      if (err.code === 'auth/credential-already-in-use') {
        const result = await signInWithEmailLink(auth, email, window.location.href);
        localStorage.removeItem('emailForSignIn');
        window.history.replaceState({}, document.title, window.location.pathname);
        return result.user;
      }
      throw err;
    }
  }
  const result = await signInWithEmailLink(auth, email, window.location.href);
  localStorage.removeItem('emailForSignIn');
  window.history.replaceState({}, document.title, window.location.pathname);
  return result.user;
}

/** Sign out the current user */
export async function signOutUser() {
  await _signOut(auth);
}
