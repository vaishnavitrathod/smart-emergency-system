import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { API_URL } from '../config';
import { auth, db } from '../firebase';

export async function loadMyMedicalId(uid) {
  const snapshot = await getDoc(doc(db, 'medicalIds', uid));
  return snapshot.exists() ? snapshot.data() : { bloodGroup: '', allergies: '', conditions: '', medications: '' };
}

export function saveMyMedicalId(uid, details) {
  const value = {};
  for (const field of ['bloodGroup', 'allergies', 'conditions', 'medications']) {
    const text = String(details[field] || '').trim();
    if (text.length > 1000) throw new Error('Each Medical ID field must be 1,000 characters or fewer.');
    value[field] = text;
  }
  return setDoc(doc(db, 'medicalIds', uid), { ...value, updatedAt: serverTimestamp() }, { merge: true });
}

export async function loadMedicalIdForIncident(incidentId) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to view Medical ID.');
  const token = await user.getIdToken();
  const response = await fetch(`${API_URL}/incidents/${encodeURIComponent(incidentId)}/medical-id`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data.medicalId || null;
}
