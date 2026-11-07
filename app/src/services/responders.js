import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const RESPONDER_TYPES = ['medical', 'security', 'fire', 'volunteer'];

export async function applyToRespond({ uid, responderType, note }) {
  if (!RESPONDER_TYPES.includes(responderType)) throw new Error('Choose a responder specialty.');
  const trimmed = (note || '').trim();
  if (!trimmed || trimmed.length > 500) throw new Error('Add an ID or certification note (up to 500 characters).');
  await updateDoc(doc(db, 'users', uid), {
    responderApplication: {
      type: responderType,
      note: trimmed,
      status: 'pending',
      submittedAt: serverTimestamp(),
    },
  });
}
