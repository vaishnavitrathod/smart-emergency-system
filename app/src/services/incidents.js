import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { advanceIncident, dispatchIncident, notifyContacts } from './dispatch';
import { reverseGeocode } from './places';
import { normalizePhoneNumber } from './auth';

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const STATUSES = ['ACTIVE', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'RESOLVED', 'CANCELLED', 'ESCALATED'];
export const STATUS_TRANSITIONS = {
  ACTIVE: ['ASSIGNED', 'CANCELLED', 'ESCALATED'],
  ASSIGNED: ['EN_ROUTE', 'CANCELLED', 'ESCALATED'],
  EN_ROUTE: ['ARRIVED', 'CANCELLED', 'ESCALATED'],
  ARRIVED: ['RESOLVED'],
  ESCALATED: ['ASSIGNED', 'CANCELLED', 'RESOLVED'],
  RESOLVED: [],
  CANCELLED: [],
};
export const MAX_CONTACTS = 3;

function currentUser() {
  if (!auth.currentUser) throw new Error('Sign in to use Emergency Response.');
  return auth.currentUser;
}

export function newIncidentId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return `INC-${ymd}-${suffix}`;
}

function buildMessage(id, classification, location) {
  const link = `https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=17/${location.lat}/${location.lng}`;
  return `SOS ${id}: ${classification.type} emergency (${classification.priority}). I need help. Location: ${link}`;
}

// 'estimate' lets a just-created incident render before the server timestamp arrives.
function readIncident(snap) {
  const data = snap.data({ serverTimestamps: 'estimate' });
  return { ...data, id: snap.id, createdMs: data.createdAt?.toMillis?.() ?? Date.now() };
}

function incidentData(id, userId, location, description, classification, status, createdAt, geo, anonymous = false, silent = false) {
  return {
    id,
    userId: anonymous ? null : userId,
    location,
    userLocation: location,
    description,
    type: classification.type,
    category: classification.type,
    priority: classification.priority,
    recommendedAction: classification.action,
    classifiedBy: classification.source,
    address: geo?.address || '',
    generalArea: geo?.generalArea || '',
    nearestLandmark: geo?.generalArea || '',
    landmarkDistanceM: null,
    status,
    assignedResponderId: null,
    assignedResponderName: null,
    assignedGuardId: null,
    assignedGuardName: null,
    assignedAt: null,
    acceptedAt: null,
    arrivedAt: null,
    resolvedAt: null,
    cancelledAt: null,
    escalationLevel: 0,
    anonymous: Boolean(anonymous),
    silent: Boolean(silent),
    timeline: [{ status, at: Timestamp.now(), by: anonymous ? 'user' : userId }],
    message: buildMessage(id, classification, location),
    createdAt,
  };
}

export async function createIncident({ id: requestedId, location, description, classification, anonymous = false, silent = false }) {
  const user = currentUser();
  const id = requestedId || newIncidentId();
  const existing = await getDoc(doc(db, 'incidents', id));
  if (existing.exists()) {
    if (existing.data().userId === user.uid) return id;
    const existingPrivate = await getDoc(doc(db, 'incidentsPrivate', id));
    if (existingPrivate.exists() && existingPrivate.data().userId === user.uid) return id;
    throw new Error('Incident ID collision. Please send the SOS again.');
  }
  const profileSnapshot = await getDoc(doc(db, 'users', user.uid));
  const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
  let geo = null;
  try {
    geo = await Promise.race([
      reverseGeocode(location.lat, location.lng),
      new Promise((resolve) => setTimeout(() => resolve(null), 1800)),
    ]);
  } catch { geo = null; }
  const data = incidentData(id, user.uid, location, description, classification, 'ACTIVE', serverTimestamp(), geo, anonymous, silent);
  const batch = writeBatch(db);
  batch.set(doc(db, 'incidents', id), data);
  batch.set(doc(db, 'publicTracking', id), {
    status: 'ACTIVE',
    nearestLandmark: geo?.generalArea || '',
    generalArea: geo?.generalArea || '',
    userLocation: { lat: location.lat, lng: location.lng },
    updatedAt: serverTimestamp(),
    frozen: false,
  });
  batch.set(doc(db, 'incidentsPrivate', id), {
    userId: user.uid,
    name: profile.name || '',
    email: profile.email || user.email || '',
    phone: profile.phone || '',
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  // Notify contacts in the background so a sleeping API doesn't delay the SOS screen.
  notifyContacts(id).catch((error) => console.warn(`Contact notification deferred: ${error.message}`));
  await dispatchIncident(id).catch((error) => console.warn(`Dispatch request deferred: ${error.message}`));
  return id;
}

// Starts a Firestore listener for the current signed-in user.
function afterSignIn(start, onError) {
  const user = auth.currentUser;
  if (!user) {
    onError(new Error('Sign in to use Emergency Response.'));
    return () => undefined;
  }
  try {
    return start(user);
  } catch (error) {
    onError(error);
    return () => undefined;
  }
}

export function subscribeIncident(id, onData, onError) {
  return afterSignIn(
    () =>
      onSnapshot(
        doc(db, 'incidents', id),
        (snap) => onData(snap.exists() ? readIncident(snap) : null),
        onError
      ),
    onError
  );
}

export function subscribeIncidents(onData, onError) {
  return afterSignIn(() => {
    const q = query(collection(db, 'incidents'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => onData(snap.docs.map(readIncident)), onError);
  }, onError);
}

export function subscribeGuardAssignments(uid, onData, onError) {
  return afterSignIn(() => {
    const responderRows = new Map();
    const legacyRows = new Map();
    const publish = () => {
      const rows = new Map([...legacyRows, ...responderRows]);
      onData([...rows.values()].filter((incident) => !['RESOLVED', 'CANCELLED'].includes(incident.status)).sort((a, b) => a.createdMs - b.createdMs));
    };
    const listenTo = (rows) => (snapshot) => {
      rows.clear();
      snapshot.docs.forEach((item) => rows.set(item.id, readIncident(item)));
      publish();
    };
    const stopResponder = onSnapshot(query(collection(db, 'incidents'), where('assignedResponderId', '==', uid)), listenTo(responderRows), onError);
    const stopLegacy = onSnapshot(query(collection(db, 'incidents'), where('assignedGuardId', '==', uid)), listenTo(legacyRows), onError);
    return () => { stopResponder(); stopLegacy(); };
  }, onError);
}

export function subscribeMyIncidents(uid, onData, onError) {
  return afterSignIn(() => {
    const indexQuery = query(collection(db, 'incidentsPrivate'), where('userId', '==', uid));
    const legacyQuery = query(collection(db, 'incidents'), where('userId', '==', uid));
    const subscriptions = new Map();
    const rows = new Map();
    let privateIds = new Set();
    let legacyIds = new Set();
    const publish = () => onData([...rows.values()].sort((a, b) => b.createdMs - a.createdMs));
    const reconcile = () => {
      const wanted = new Set([...privateIds, ...legacyIds]);
      for (const [id, stop] of subscriptions.entries()) {
        if (!wanted.has(id)) { stop(); subscriptions.delete(id); rows.delete(id); }
      }
      for (const id of wanted) {
        if (subscriptions.has(id)) continue;
        const stop = onSnapshot(doc(db, 'incidents', id), (incidentSnapshot) => {
          if (incidentSnapshot.exists()) rows.set(id, readIncident(incidentSnapshot));
          else rows.delete(id);
          publish();
        }, onError);
        subscriptions.set(id, stop);
      }
      publish();
    };
    const stopIndex = onSnapshot(indexQuery, (snapshot) => { privateIds = new Set(snapshot.docs.map((item) => item.id)); reconcile(); }, onError);
    const stopLegacy = onSnapshot(legacyQuery, (snapshot) => { legacyIds = new Set(snapshot.docs.map((item) => item.id)); reconcile(); }, onError);
    return () => { stopIndex(); stopLegacy(); subscriptions.forEach((stop) => stop()); subscriptions.clear(); };
  }, onError);
}

export function setStatus(id, status) {
  if (!STATUSES.includes(status)) return Promise.reject(new Error('Choose a valid incident status.'));
  return advanceIncident(id, status);
}

// Contacts: queried with a single where() so no composite index is needed.
export function subscribeContacts(onData, onError) {
  return afterSignIn((user) => {
    const q = query(collection(db, 'contacts'), where('userId', '==', user.uid));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data({ serverTimestamps: 'estimate' });
          return { ...data, id: d.id, createdMs: data.createdAt?.toMillis?.() ?? 0 };
        });
        onData(list.sort((a, b) => a.createdMs - b.createdMs));
      },
      onError
    );
  }, onError);
}

export async function addContact(name, phone) {
  const user = currentUser();
  const ref = doc(collection(db, 'contacts'));
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) throw new Error('Enter a phone number with its country code.');
  await setDoc(ref, { userId: user.uid, name, phone: normalizedPhone, createdAt: serverTimestamp() });
}

export function removeContact(id) {
  return deleteDoc(doc(db, 'contacts', id));
}
