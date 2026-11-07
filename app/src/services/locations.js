import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { CAMPUS_CENTER } from '../config';
import { auth, db } from '../firebase';

export const LOCATION_TYPES = ['hospital', 'police', 'fire', 'shelter', 'community', 'transport', 'other', 'gate', 'hostel', 'academic', 'library', 'canteen', 'ground', 'medical', 'security'];

function requireSignedIn() {
  if (!auth.currentUser) throw new Error('Sign in to manage configured response sites.');
}

function validateLocation(location) {
  const name = (location.name || '').trim();
  const type = location.type;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!name) throw new Error('Enter a location name.');
  if (!LOCATION_TYPES.includes(type)) throw new Error('Choose a valid location type.');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error('Tap the map to choose valid coordinates.');
  }
  return { name, type, lat, lng };
}

export function subscribeCampusLocations(onData, onError) {
  requireSignedIn();
  return onSnapshot(
    query(collection(db, 'campusLocations')),
    (snapshot) => onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => a.name.localeCompare(b.name))),
    onError
  );
}

export async function getCampusLocations() {
  requireSignedIn();
  const snapshot = await getDocs(collection(db, 'campusLocations'));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function addCampusLocation(location) {
  requireSignedIn();
  const clean = validateLocation(location);
  const result = await addDoc(collection(db, 'campusLocations'), { ...clean, createdAt: serverTimestamp() });
  return result.id;
}

export function updateCampusLocation(id, location) {
  requireSignedIn();
  return updateDoc(doc(db, 'campusLocations', id), validateLocation(location));
}

export function deleteCampusLocation(id) {
  requireSignedIn();
  return deleteDoc(doc(db, 'campusLocations', id));
}

export function haversineMeters(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(haversine));
}

export function nearestCampusLocation(point, locations) {
  if (!locations.length) return { name: null, distanceM: null };
  const nearest = locations
    .map((location) => ({ location, distanceM: haversineMeters(point, location) }))
    .sort((a, b) => a.distanceM - b.distanceM)[0];
  return { name: nearest.location.name, distanceM: Math.round(nearest.distanceM) };
}
