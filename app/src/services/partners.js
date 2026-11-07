import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { haversineKm } from './places';

export function subscribePartners(onData, onError) {
  return onSnapshot(collection(db, 'partners'), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
  }, onError);
}

export async function findNearbyPartners(location, category) {
  const snapshot = await getDocs(collection(db, 'partners'));
  const preferred = category === 'Medical' ? ['hospital']
    : category === 'Fire' || category === 'Natural hazard' ? ['fire', 'helpline', 'ngo']
      : category === 'Crime/Safety' || category === 'Harassment' ? ['police', 'helpline', 'ngo']
        : [];
  return snapshot.docs.map((item) => {
    const data = item.data();
    const distanceKm = haversineKm(location, { lat: data.lat, lng: data.lng });
    return { id: item.id, ...data, distanceKm };
  }).sort((a, b) => {
    const aPreferred = preferred.length === 0 || preferred.includes(a.type) ? 0 : 1;
    const bPreferred = preferred.length === 0 || preferred.includes(b.type) ? 0 : 1;
    return aPreferred - bPreferred || a.distanceKm - b.distanceKm;
  });
}
