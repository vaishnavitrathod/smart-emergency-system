import { API_URL } from '../config';
import { auth } from '../firebase';

const DEFAULT_RESULT = { type: 'Other', priority: 'Medium', action: 'Stay safe and monitor the situation; call emergency services if it worsens', source: 'default' };
export const INCIDENT_CATEGORIES = ['Medical', 'Fire', 'Crime/Safety', 'Accident', 'Harassment', 'Natural hazard', 'Other'];

// Mirrors the backend keyword rules; first match wins.
const RULES = [
  [/unconscious|not breathing|not responding|seizure|bleeding|choking|overdose|heart attack/i, 'Medical', 'Critical'],
  [/fire|smoke|explosion|gas leak/i, 'Fire', 'Critical'],
  [/earthquake|flood|landslide|hurricane|cyclone|tornado|wildfire|storm|lightning|avalanche/i, 'Natural hazard', 'Critical'],
  [/harass|stalk|bully|sexual harassment/i, 'Harassment', 'High'],
  [/assault|weapon|robbery|threat|unsafe|break-in|crime|attack/i, 'Crime/Safety', 'High'],
  [/accident|crash|fell|trapped/i, 'Accident', 'High'],
  [/pain|fever|dizzy/i, 'Medical', 'Medium'],
];

function actionFor(priority) {
  return priority === 'Critical' || priority === 'High'
    ? 'Call emergency services'
    : 'Stay safe and monitor the situation; call emergency services if it worsens';
}

export function localClassify(text) {
  for (const [pattern, type, priority] of RULES) {
    if (pattern.test(text)) return { type, priority, action: actionFor(priority), source: 'local' };
  }
  return { type: 'Other', priority: 'Medium', action: actionFor('Medium'), source: 'local' };
}

// Never throws: any API problem falls back to the local classifier.
export async function classify(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return DEFAULT_RESULT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
    if (!token) throw new Error('Sign in is required for server classification.');
    const res = await fetch(`${API_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: trimmed }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!INCIDENT_CATEGORIES.includes(data.type) || !data.priority || !data.action) throw new Error('bad response');
    return data;
  } catch {
    return localClassify(trimmed);
  } finally {
    clearTimeout(timer);
  }
}
