import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { geocodeAddress } from '../../services/places';
import { cancelLocalNotification, scheduleSafeWalkReminder } from '../../services/notifications';
import { checkInSafeWalk, createSafeWalk, subscribeActiveSafeWalks } from '../../services/safeWalks';
import { translate } from '../../services/i18n';
import { auth } from '../../firebase';
import { colors, shared } from '../../theme';

const DURATIONS = [5, 10, 15, 30, 45, 60];

function toDate(value) {
  return value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : null);
}

export default function SafeWalkScreen({ profile }) {
  const language = profile?.language || 'en';
  const [walks, setWalks] = useState([]);
  const [duration, setDuration] = useState(15);
  const [destination, setDestination] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const activeWalk = useMemo(() => [...walks].sort((a, b) => (toDate(a.endsAt)?.getTime() || 0) - (toDate(b.endsAt)?.getTime() || 0))[0] || null, [walks]);

  useEffect(() => subscribeActiveSafeWalks(auth.currentUser.uid, setWalks, (e) => setError(`Could not load Safe Walk: ${e.message}`)), []);

  useEffect(() => {
    if (!activeWalk) { setSecondsLeft(0); return undefined; }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil(((toDate(activeWalk.endsAt)?.getTime() || 0) - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [activeWalk?.id, activeWalk?.endsAt]);

  async function start() {
    setBusy(true); setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Allow foreground location so responders can find you if the timer expires.');
      let destinationDetails = destination.trim() ? { name: destination.trim() } : null;
      if (destinationDetails) {
        try { destinationDetails = { ...destinationDetails, ...(await geocodeAddress(destinationDetails.name) || {}) }; }
        catch { setError('The safe journey started, but the destination could not be mapped.'); }
      }
      const walk = await createSafeWalk(duration, destinationDetails);
      try {
        const notificationId = await scheduleSafeWalkReminder(walk.id, walk.endsAt);
        if (!notificationId) setError('Safe Walk started. Notifications are disabled here; the timer and server alert still work.');
      } catch (e) { setError(`Safe Walk started. The reminder could not be scheduled: ${e.message}`); }
      // The persisted expiry is handled by the server worker even if the app closes.
    } catch (e) { setError(`Could not start Safe Walk: ${e.message}`); }
    finally { setBusy(false); }
  }

  async function checkIn() {
    if (!activeWalk) return;
    setBusy(true); setError('');
    try {
      await checkInSafeWalk(activeWalk.id);
      await cancelLocalNotification(activeWalk.id).catch(() => undefined);
    } catch (e) { setError(`Could not check in: ${e.message}`); }
    finally { setBusy(false); }
  }

  const time = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;
  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={shared.card}>
        <Text style={shared.title}>{translate('safeJourneyTitle', language)}</Text>
        <Text style={shared.muted}>{translate('safeJourneyIntro', language)}</Text>
        {activeWalk ? (
          <>
            <Text style={[shared.title, { color: colors.red, fontSize: 34 }]}>{time}</Text>
            <Text style={shared.text}>Destination: {activeWalk.destination?.name || 'Not specified'}</Text>
            <Pressable style={shared.button} onPress={checkIn} disabled={busy} accessibilityRole="button">
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={shared.buttonText}>I’m safe</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={shared.heading}>{translate('chooseDuration', language)}</Text>
            <View style={shared.row}>{DURATIONS.map((value) => (
              <Pressable key={value} onPress={() => setDuration(value)} style={{ ...shared.pill, borderColor: duration === value ? colors.red : colors.border }} accessibilityRole="button" accessibilityState={{ selected: duration === value }}>
                <Text style={shared.pillText}>{value} min</Text>
              </Pressable>
            ))}</View>
            <Text style={shared.heading}>{translate('optionalDestination', language)}</Text>
            <TextInput style={shared.input} placeholder={translate('destinationPlaceholder', language)} value={destination} onChangeText={setDestination} maxLength={200} accessibilityLabel={translate('optionalDestination', language)} />
            <Pressable style={shared.button} onPress={start} disabled={busy} accessibilityRole="button">
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={shared.buttonText}>{translate('startSafeJourney', language)}</Text>}
            </Pressable>
          </>
        )}
        {!!error && <Text style={shared.error}>{error}</Text>}
      </View>
    </ScrollView>
  );
}
