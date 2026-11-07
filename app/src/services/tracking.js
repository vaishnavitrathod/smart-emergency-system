import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';

export function updateStudentLocation(incidentId, location) {
  if (!auth.currentUser) throw new Error('Sign in to share incident location.');
  const batch = writeBatch(db);
  const point = { lat: location.lat, lng: location.lng };
  const updatedAt = serverTimestamp();
  batch.update(doc(db, 'incidents', incidentId), { userLocation: point, userLocationUpdatedAt: updatedAt });
  batch.set(doc(db, 'publicTracking', incidentId), { userLocation: point, updatedAt }, { merge: true });
  return batch.commit();
}
