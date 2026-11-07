import { auth } from '../firebase';
import { API_URL } from '../config';

async function request(path, method = 'GET', body) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to continue.');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
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

