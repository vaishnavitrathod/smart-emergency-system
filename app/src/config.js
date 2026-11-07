// Expo inlines EXPO_PUBLIC_* values only when written as process.env.EXPO_PUBLIC_NAME.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
export const EMERGENCY_NUMBER = (process.env.EXPO_PUBLIC_EMERGENCY_NUMBER || '').trim();
export const LOCAL_RESPONSE_NUMBER = (
  process.env.EXPO_PUBLIC_LOCAL_RESPONSE_NUMBER || process.env.EXPO_PUBLIC_CAMPUS_SECURITY_NUMBER || ''
).trim();
export const ALLOWED_EMAIL_DOMAIN = (process.env.EXPO_PUBLIC_ALLOWED_EMAIL_DOMAIN || '')
  .trim()
  .replace(/^@/, '')
  .toLowerCase();
export const TRACKING_BASE_URL = (process.env.EXPO_PUBLIC_TRACKING_BASE_URL || '').replace(/\/$/, '');
export const PUBLIC_TRACKING_ORIGIN = TRACKING_BASE_URL;

export function publicTrackingUrl(incidentId) {
  let origin = PUBLIC_TRACKING_ORIGIN;
  if (!origin && typeof window !== 'undefined' && window.location?.origin) origin = window.location.origin;
  return origin ? `${origin}/track/${encodeURIComponent(incidentId)}` : '';
}

export const DEFAULT_COUNTRY_CODE = (process.env.EXPO_PUBLIC_DEFAULT_COUNTRY_CODE || '').replace(/[^0-9]/g, '');
export const SUPPORTED_LANGUAGES = (process.env.EXPO_PUBLIC_SUPPORTED_LANGUAGES || 'en,hi')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
export const DEFAULT_LANGUAGE = (process.env.EXPO_PUBLIC_DEFAULT_LANGUAGE || SUPPORTED_LANGUAGES[0] || 'en').toLowerCase();
export const MAP_TILES_URL = process.env.EXPO_PUBLIC_MAP_TILES_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function parseCenter(value) {
  const [lat, lng] = (value || '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: 0, lng: 0 };
}

export const MAP_CENTER = parseCenter(process.env.EXPO_PUBLIC_MAP_CENTER || process.env.EXPO_PUBLIC_CAMPUS_CENTER);
// Kept as an alias for older screens and existing .env files.
export const CAMPUS_CENTER = MAP_CENTER;

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

// Used for the map when the user's location is unavailable.
export const DEFAULT_CENTER = MAP_CENTER;
