import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const silent = notification.request.content.data?.silent === true;
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: !silent,
      shouldSetBadge: false,
    };
  },
});

export async function registerPushToken() {
  if (Platform.OS === 'web' || !Device.isDevice || !auth.currentUser) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Emergency response alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 350, 200, 350],
      lightColor: '#D32F2F',
    });
  }
  const permissions = await Notifications.getPermissionsAsync();
  let status = permissions.status;
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  const result = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await updateDoc(doc(db, 'users', auth.currentUser.uid), { pushToken: result.data });
  return result.data;
}

export async function scheduleSafeWalkReminder(walkId, endsAt) {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  const permissions = await Notifications.getPermissionsAsync();
  const status = permissions.status === 'granted' ? 'granted' : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const triggerDate = new Date(endsAt.getTime() - 60_000);
  if (triggerDate <= new Date()) return null;
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Safe Walk check-in',
      body: 'Your Safe Walk ends in one minute. Tap “I’m safe” when you arrive.',
      data: { safeWalkId: walkId },
    },
    trigger: triggerDate,
  });
  await AsyncStorage.setItem(`campus-sos-safe-walk-notification-${walkId}`, notificationId);
  return notificationId;
}

export async function cancelLocalNotification(walkId) {
  if (!walkId || Platform.OS === 'web') return;
  const key = `campus-sos-safe-walk-notification-${walkId}`;
  const notificationId = await AsyncStorage.getItem(key);
  if (notificationId) await Notifications.cancelScheduledNotificationAsync(notificationId);
  await AsyncStorage.removeItem(key);
}
