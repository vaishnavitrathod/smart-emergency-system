import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { firebaseConfig, isFirebaseConfigured } from './config';

// Guards keep fast refresh from re-initialising already created instances.
// Placeholder values let the app load and show a setup message when the .env is empty.
const PLACEHOLDER = { apiKey: 'unconfigured', projectId: 'unconfigured', appId: 'unconfigured' };
const app = getApps().length ? getApp() : initializeApp(isFirebaseConfigured ? firebaseConfig : PLACEHOLDER);

function createAuth() {
  if (Platform.OS === 'web') return getAuth(app);
  try {
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    return getAuth(app);
  }
}

function createDb() {
  try {
    return initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch {
    return getFirestore(app);
  }
}

export const auth = createAuth();
export const db = createDb();
