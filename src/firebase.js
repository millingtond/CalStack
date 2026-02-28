import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
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

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

/**
 * Wait for anonymous auth to resolve.
 * Returns the uid. If the user has previously visited,
 * Firebase restores the same anonymous uid automatically,
 * so all their data persists across sessions.
 */
export function waitForAuth() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (user) {
        resolve(user.uid);
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
 * Link anonymous account to Google, or sign in with Google if already linked.
 * Preserves all existing data when linking for the first time.
 * NOTE: Enable Google Sign-In in Firebase Console → Authentication → Sign-in methods.
 */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const user = auth.currentUser;
  if (user?.isAnonymous) {
    try {
      const result = await linkWithPopup(user, provider);
      return result.user;
    } catch (err) {
      if (err.code === 'auth/credential-already-in-use') {
        // Google account already has its own Firebase account — sign in to it instead
        const result = await signInWithCredential(auth, err.credential);
        return result.user;
      }
      throw err;
    }
  } else {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  }
}

/**
 * Link anonymous account to Apple, or sign in with Apple.
 * NOTE: Requires Apple Developer account + Services ID. Enable Apple Sign-In
 * in Firebase Console → Authentication → Sign-in methods, and configure
 * your Apple Services ID, Team ID, Key ID, and private key.
 */
export async function signInWithApple() {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  const user = auth.currentUser;
  if (user?.isAnonymous) {
    try {
      const result = await linkWithPopup(user, provider);
      return result.user;
    } catch (err) {
      if (err.code === 'auth/credential-already-in-use') {
        const result = await signInWithCredential(auth, err.credential);
        return result.user;
      }
      throw err;
    }
  } else {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  }
}

/**
 * Sign in with email + password.
 * Links anonymous account if this is the first sign-in on this device.
 * NOTE: Enable Email/Password in Firebase Console → Authentication → Sign-in methods.
 */
export async function signInWithEmail(email, password) {
  const user = auth.currentUser;
  if (user?.isAnonymous) {
    const credential = EmailAuthProvider.credential(email, password);
    try {
      const result = await linkWithCredential(user, credential);
      return result.user;
    } catch (err) {
      if (err.code === 'auth/credential-already-in-use' || err.code === 'auth/email-already-in-use') {
        const result = await signInWithEmailAndPassword(auth, email, password);
        return result.user;
      }
      throw err;
    }
  } else {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  }
}

/**
 * Create a new email + password account.
 * Links the anonymous account to preserve existing data.
 */
export async function createEmailAccount(email, password) {
  const user = auth.currentUser;
  if (user?.isAnonymous) {
    const credential = EmailAuthProvider.credential(email, password);
    const result = await linkWithCredential(user, credential);
    return result.user;
  } else {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    return result.user;
  }
}

/**
 * Send a magic (passwordless) sign-in link to the given email.
 * Saves the email in localStorage so we can complete sign-in when the link is clicked.
 * NOTE: Enable Email link (passwordless) in Firebase Console → Authentication →
 * Sign-in methods → Email/Password → Enable "Email link (passwordless sign-in)".
 * Also add your domain to the Authorized Domains list.
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
 * Complete magic link sign-in when the user opens the link in their email.
 * Call this on app start; it's a no-op if the current URL is not a magic link.
 * Returns the signed-in user, or null if the URL is not a magic link.
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
  } else {
    const result = await signInWithEmailLink(auth, email, window.location.href);
    localStorage.removeItem('emailForSignIn');
    window.history.replaceState({}, document.title, window.location.pathname);
    return result.user;
  }
}

/** Sign out the current user */
export async function signOutUser() {
  await _signOut(auth);
}
