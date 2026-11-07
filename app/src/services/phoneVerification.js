import { API_URL } from '../config';
import { auth } from '../firebase';

async function request(path, body) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to verify your phone number.');
  const token = await user.getIdToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export function sendPhoneCode(phone) {
  return request('/phone-verification/start', { phone });
}

export function confirmPhoneCode(phone, code) {
  return request('/phone-verification/check', { phone, code });
}
