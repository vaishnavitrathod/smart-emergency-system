import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebase';

function signedIn() {
  if (!auth.currentUser) throw new Error('Sign in to use Safe Walk.');
  return auth.currentUser;
}

export function subscribeActiveSafeWalks(uid, onData, onError) {
  signedIn();
  return onSnapshot(
    query(collection(db, 'safeWalks'), where('userId', '==', uid), where('status', '==', 'ACTIVE')),
    (snapshot) => onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError
  );
}

export async function createSafeWalk(durationMinutes, destination) {
  const user = signedIn();
  const duration = Number(durationMinutes);
  if (!Number.isInteger(duration) || duration < 5 || duration > 60) throw new Error('Choose a duration from 5 to 60 minutes.');
  const endsAt = new Date(Date.now() + duration * 60_000);
  const result = await addDoc(collection(db, 'safeWalks'), {
    userId: user.uid,
    status: 'ACTIVE',
    durationMinutes: duration,
    destination: destination || null,
    startsAt: serverTimestamp(),
    endsAt: Timestamp.fromDate(endsAt),
    lastLocation: null,
    createdAt: serverTimestamp(),
  });
  return { id: result.id, endsAt };
}

export function checkInSafeWalk(id) {
  signedIn();
  return updateDoc(doc(db, 'safeWalks', id), { status: 'SAFE', checkedInAt: serverTimestamp() });
}

export function updateSafeWalkLocation(id, location) {
  signedIn();
  return updateDoc(doc(db, 'safeWalks', id), {
    lastLocation: { lat: location.lat, lng: location.lng },
    lastLocationAt: serverTimestamp(),
  });
}
