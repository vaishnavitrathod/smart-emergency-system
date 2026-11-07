import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { isFirebaseConfigured } from './src/config';
import { auth, db } from './src/firebase';
import AuthNavigator from './src/navigation/AuthNavigator';
import RoleNavigator from './src/navigation/RoleNavigator';
import StudentTrackingCoordinator from './src/components/StudentTrackingCoordinator';
import StudentSafetyBar from './src/components/StudentSafetyBar';
import ConsentScreen from './src/screens/auth/ConsentScreen';
import { registerPushToken } from './src/services/notifications';
import { signOut } from './src/services/auth';
import { colors, shared } from './src/theme';
import TrackScreen from './src/screens/TrackScreen';

const RootStack = createNativeStackNavigator();
const VALID_ROLES = new Set(['user', 'responder', 'operator', 'admin', 'student', 'guard']);
const CONSENT_VERSION = 'emergency-response-privacy-v2';

function Notice({ title, children, action }) {
  return (
    <View style={shared.center}>
      <Text style={shared.title}>{title}</Text>
      <Text style={[shared.text, { textAlign: 'center', maxWidth: 480 }]}>{children}</Text>
      {action}
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState({ loading: true, user: null, profile: null, error: '' });
  const [trackingIssue, setTrackingIssue] = useState('');
  const [pushRegisteredUid, setPushRegisteredUid] = useState('');
  const [publicIncidentId, setPublicIncidentId] = useState(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
    return window.location.pathname.match(/^\/track\/([^/]+)/)?.[1] || '';
  });

  useEffect(() => {
    if (publicIncidentId || Platform.OS === 'web') return undefined;
    let mounted = true;
    Linking.getInitialURL().then((url) => {
      const match = url?.match(/\/track\/([^/?#]+)/);
      if (mounted && match) setPublicIncidentId(decodeURIComponent(match[1]));
    });
    return () => { mounted = false; };
  }, [publicIncidentId]);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setSession({ loading: false, user: null, profile: null, error: '' });
      return undefined;
    }

    let stopProfile = null;
    const stopAuth = onAuthStateChanged(
      auth,
      (user) => {
        if (stopProfile) {
          stopProfile();
          stopProfile = null;
        }
        if (!user) {
          setSession({ loading: false, user: null, profile: null, error: '' });
          return;
        }
        setSession({ loading: true, user, profile: null, error: '' });
        stopProfile = onSnapshot(
          doc(db, 'users', user.uid),
          (snapshot) =>
            setSession({
              loading: false,
              user,
              profile: snapshot.exists() ? snapshot.data() : null,
              error: '',
            }),
          (error) => setSession({ loading: false, user, profile: null, error: error.message })
        );
      },
      (error) => setSession({ loading: false, user: null, profile: null, error: error.message })
    );

    return () => {
      stopAuth();
      if (stopProfile) stopProfile();
    };
  }, []);

  useEffect(() => {
    const uid = session.user?.uid;
    if (!uid || session.profile?.consentVersion !== CONSENT_VERSION || pushRegisteredUid === uid) return;
    setPushRegisteredUid(uid);
    registerPushToken().catch((error) => console.warn(`Push notifications are unavailable: ${error.message}`));
  }, [session.user?.uid, session.profile?.consentVersion, pushRegisteredUid]);

  async function acceptConsent() {
    await updateDoc(doc(db, 'users', session.user.uid), {
      consentVersion: CONSENT_VERSION,
      consentAt: serverTimestamp(),
    });
  }

  if (publicIncidentId) return <TrackScreen incidentId={decodeURIComponent(publicIncidentId)} />;

  if (!isFirebaseConfigured) {
    return (
      <Notice title="Firebase is not configured">
        Copy .env.example to .env, fill in the EXPO_PUBLIC_FIREBASE_* values, then restart with npx expo start -c.
      </Notice>
    );
  }
  if (session.loading) {
    return (
      <View style={shared.center}>
        <ActivityIndicator size="large" color={colors.red} />
      </View>
    );
  }
  if (session.error) {
    return <Notice title="Could not load your account">{session.error}</Notice>;
  }
  if (session.user && !session.profile) {
    return (
      <Notice
        title="Account profile not found"
        action={
          <Pressable style={shared.button} onPress={() => signOut()} accessibilityRole="button">
            <Text style={shared.buttonText}>Sign out</Text>
          </Pressable>
        }
      >
        Sign out and ask a system administrator to check your account setup.
      </Notice>
    );
  }
  if (session.profile?.disabled) {
    return (
      <Notice
        title="Account deactivated"
        action={
          <Pressable style={shared.button} onPress={() => signOut()} accessibilityRole="button">
            <Text style={shared.buttonText}>Sign out</Text>
          </Pressable>
        }
      >
        Contact a system administrator if you think this is a mistake.
      </Notice>
    );
  }
  if (session.profile && !VALID_ROLES.has(session.profile.role)) {
    return <Notice title="Account role is not valid">Contact a system administrator to review your account.</Notice>;
  }
  if (session.user && session.profile?.consentVersion !== CONSENT_VERSION) {
    return <ConsentScreen onAccept={acceptConsent} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" />
      {session.user && session.profile?.consentVersion === CONSENT_VERSION && ['user', 'student'].includes(session.profile?.role) && (
        <StudentTrackingCoordinator uid={session.user.uid} onIssue={setTrackingIssue} />
      )}
      {trackingIssue && ['user', 'student'].includes(session.profile?.role) && (
        <View style={{ backgroundColor: colors.redDark, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.white, flex: 1 }}>{trackingIssue}</Text>
          <Pressable onPress={() => setTrackingIssue('')} accessibilityRole="button">
            <Text style={{ color: colors.white, fontWeight: '700', padding: 8 }}>Dismiss</Text>
          </Pressable>
        </View>
      )}
      <NavigationContainer>
        {session.user ? (
          <RoleNavigator user={session.user} profile={session.profile} onSignOut={signOut} />
        ) : (
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            <RootStack.Screen name="Authentication" component={AuthNavigator} />
          </RootStack.Navigator>
        )}
      </NavigationContainer>
      {session.user && session.profile?.consentVersion === CONSENT_VERSION && <StudentSafetyBar profile={session.profile} />}
    </View>
  );
}
