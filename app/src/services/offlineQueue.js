import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';

const KEY = 'campus-sos-pending-incidents-v1';

export async function readOfflineQueue() {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'); }
  catch { return []; }
}

export async function queueOfflineIncident(incident) {
  const queue = await readOfflineQueue();
  const next = [...queue.filter((item) => item.id !== incident.id), incident];
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function removeQueuedIncident(id) {
  const queue = (await readOfflineQueue()).filter((item) => item.id !== id);
  await AsyncStorage.setItem(KEY, JSON.stringify(queue));
  return queue;
}

export async function hasInternetConnection() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch { return typeof navigator === 'undefined' || navigator.onLine !== false; }
}

export function listenForNetworkChanges(listener) {
  if (typeof Network.addNetworkStateListener === 'function') {
    const subscription = Network.addNetworkStateListener((state) => listener(state.isConnected !== false && state.isInternetReachable !== false));
    return () => subscription.remove();
  }
  if (typeof window !== 'undefined') {
    const online = () => listener(true);
    const offline = () => listener(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }
  return () => undefined;
}
