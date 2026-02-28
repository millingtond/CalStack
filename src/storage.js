import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';

let _uid = null;

/** Must be called once after auth resolves */
export function setUid(uid) {
  _uid = uid;
}

function storeRef(key) {
  return doc(db, 'users', _uid, 'store', key);
}

/**
 * Load a value from Firestore.
 * Returns the parsed value or the fallback if not found.
 */
export async function load(key, fallback) {
  try {
    const snap = await getDoc(storeRef(key));
    if (snap.exists()) {
      return snap.data().value;
    }
    return fallback;
  } catch (e) {
    console.error('Firestore load error:', key, e);
    return fallback;
  }
}

/**
 * Save a value to Firestore.
 * The value can be any JSON-serializable data — it's stored
 * as-is inside a wrapper document { value: <data> }.
 */
export async function save(key, data) {
  try {
    await setDoc(storeRef(key), { value: data });
  } catch (e) {
    console.error('Firestore save error:', key, e);
  }
}

/**
 * Remove a single key from the store.
 */
export async function remove(key) {
  try {
    await deleteDoc(storeRef(key));
  } catch {}
}

/**
 * Delete ALL documents in the user's store subcollection.
 * Firestore doesn't support deleting subcollections in one call,
 * so we fetch all docs and batch-delete them.
 */
export async function clearAll() {
  try {
    const colRef = collection(db, 'users', _uid, 'store');
    const snap = await getDocs(colRef);
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (e) {
    console.error('Firestore clearAll error:', e);
  }
}
