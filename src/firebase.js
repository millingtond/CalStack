import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

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
