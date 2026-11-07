import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

export function subscribeUser(uid, onData, onError) {
  return onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
    onError
  );
}

export function setResponderDuty(uid, onDuty) {
  return updateDoc(doc(db, 'users', uid), { onDuty: Boolean(onDuty) });
}

export function setResponderLocation(uid, location) {
  return updateDoc(doc(db, 'users', uid), {
    location: { lat: location.lat, lng: location.lng },
    lastSeen: serverTimestamp(),
  });
}

export const setGuardDuty = setResponderDuty;
export const setGuardLocation = setResponderLocation;
