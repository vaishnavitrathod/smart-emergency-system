import { collection, onSnapshot } from 'firebase/firestore';
import { API_URL } from '../config';
import { auth, db } from '../firebase';

async function request(path, body, method = 'POST') {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to manage emergency operations.');
  const token = await user.getIdToken();
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export function subscribeUsers(onData, onError) {
  return onSnapshot(collection(db, 'users'), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '')));
  }, onError);
}

export async function loadResponders() {
  const result = await request('/operators/responders', null, 'GET');
  return result.responders || [];
}

export function manageUser(email, role, disabled = false) {
  return request('/admin/users', { email, role, disabled });
}

export function decideResponder(uid, decision) {
  return request(`/admin/responders/${encodeURIComponent(uid)}/decision`, { decision });
}

export function createPartner(partner) {
  return request('/admin/partners', partner);
}

export function deletePartner(id) {
  return request(`/admin/partners/${encodeURIComponent(id)}/delete`, {});
}

export function assignResponder(incidentId, responderId) {
  return request(`/admin/incidents/${encodeURIComponent(incidentId)}/assign`, { responderId });
}

export const assignGuard = assignResponder;

export function getIncidentIdentity(incidentId) {
  return request(`/admin/incidents/${encodeURIComponent(incidentId)}/identity`, {});
}
