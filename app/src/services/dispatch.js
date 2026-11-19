import { auth } from '../firebase';
import { API_URL } from '../config';

async function request(path, method = 'GET', body, timeoutMs = 8000) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to continue.');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function getGuardQueue() {
  return request('/responder/queue');
}

export const getResponderQueue = getGuardQueue;

export function dispatchIncident(id) {
  return request(`/incidents/${encodeURIComponent(id)}/dispatch`, 'POST', {});
}

export function notifyContacts(id) {
  // Render Free can take about a minute to wake after inactivity.
  return request(`/incidents/${encodeURIComponent(id)}/notify-contacts`, 'POST', {}, 75000);
}

export function getIncidentTracking(id) {
  return request(`/incidents/${encodeURIComponent(id)}/tracking`);
}

export function acceptIncident(id) {
  return request(`/incidents/${encodeURIComponent(id)}/accept`, 'POST', {});
}

export function declineIncident(id) {
  return request(`/incidents/${encodeURIComponent(id)}/decline`, 'POST', {});
}

export function advanceIncident(id, status) {
  return request(`/incidents/${encodeURIComponent(id)}/status`, 'POST', { status });
}

