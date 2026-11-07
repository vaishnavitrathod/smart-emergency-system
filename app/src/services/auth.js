import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { ALLOWED_EMAIL_DOMAIN, DEFAULT_COUNTRY_CODE, DEFAULT_LANGUAGE } from '../config';
import { auth, db } from '../firebase';

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

export function validateAccountEmail(email) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Enter a valid email address.');
  if (ALLOWED_EMAIL_DOMAIN && !normalized.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    throw new Error(`Use an email ending in @${ALLOWED_EMAIL_DOMAIN}.`);
  }
  return normalized;
}

export const validateStudentEmail = validateAccountEmail;

export function normalizePhoneNumber(value) {
  const phone = (value || '').trim();
  if (!phone) return '';
  if (!/^\+?[\d\s().-]{7,25}$/.test(phone)) throw new Error('Enter a valid phone number with its country code.');
  const digits = phone.replace(/\D/g, '');
  const normalized = phone.startsWith('+') ? `+${digits}` : DEFAULT_COUNTRY_CODE ? `+${DEFAULT_COUNTRY_CODE}${digits}` : '';
  if (!normalized || !/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error('Enter a phone number with a country code, for example +1 555 555 5555.');
  }
  return normalized;
}

export async function registerUser({ name, email, phone, password }) {
  const normalizedEmail = validateAccountEmail(email);
  const trimmedName = (name || '').trim();
  const trimmedPhone = normalizePhoneNumber(phone);
  if (!trimmedName) throw new Error('Enter your name.');
  if ((password || '').length < 8) throw new Error('Use a password with at least 8 characters.');

  const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  try {
    await setDoc(doc(db, 'users', credential.user.uid), {
      name: trimmedName,
      email: normalizedEmail,
      phone: trimmedPhone,
      role: 'user',
      createdAt: serverTimestamp(),
      disabled: false,
      language: DEFAULT_LANGUAGE,
      phoneVerified: false,
    });
  } catch (error) {
    await deleteUser(credential.user).catch(() => undefined);
    throw error;
  }
  return credential.user;
}

// Backward-compatible export while older screens migrate to the general user role.
export const registerStudent = registerUser;

export async function signIn(email, password) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) throw new Error('Enter your email and password.');
  const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
  return credential.user;
}

export function signOut() {
  return firebaseSignOut(auth);
}

export function updateOwnProfile(uid, { name, phone, language, previousPhone = '' }) {
  const trimmedName = (name || '').trim();
  const trimmedPhone = normalizePhoneNumber(phone);
  if (!trimmedName) throw new Error('Enter your name.');
  return updateDoc(doc(db, 'users', uid), {
    name: trimmedName,
    phone: trimmedPhone,
    ...(trimmedPhone !== previousPhone ? { phoneVerified: false } : {}),
    ...(language ? { language } : {}),
  });
}
