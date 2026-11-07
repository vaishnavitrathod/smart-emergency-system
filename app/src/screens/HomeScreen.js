import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { EMERGENCY_NUMBER, LOCAL_RESPONSE_NUMBER } from '../config';
import { classify, localClassify, INCIDENT_CATEGORIES } from '../services/classify';
import { createIncident, newIncidentId } from '../services/incidents';
import { geocodeAddress } from '../services/places';
import { hasInternetConnection, listenForNetworkChanges, queueOfflineIncident, readOfflineQueue, removeQueuedIncident } from '../services/offlineQueue';
import { auth } from '../firebase';
import { translate, translateCategory } from '../services/i18n';
import { colors, shared } from '../theme';

async function getLocation() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Location permission denied');
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Location timed out')), 12000));
  const position = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), timeout]);
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

function smsUrl(id, category, location) {
  const number = LOCAL_RESPONSE_NUMBER || EMERGENCY_NUMBER;
  const body = `Emergency ${id}: ${category}. My coordinates: ${location.lat}, ${location.lng}. Please send help.`;
  return `sms:${number}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

export default function HomeScreen({ navigation, profile }) {
  const language = profile?.language || 'en';
  const [text, setText] = useState('');
  const [category, setCategory] = useState('Auto');
  const [anonymous, setAnonymous] = useState(false);
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needAddress, setNeedAddress] = useState(false);
  const [address, setAddress] = useState('');
  const [queued, setQueued] = useState([]);
  const [message, setMessage] = useState('');
  const [silentIncidentId, setSilentIncidentId] = useState('');
  const mounted = useRef(true);
  const retrying = useRef(false);
  const holdTimer = useRef(null);
  const held = useRef(false);

  useEffect(() => {
    mounted.current = true;
    readOfflineQueue().then((items) => mounted.current && setQueued(items.filter((item) => item.userId === auth.currentUser?.uid)));
    retryQueue();
    const stopNetwork = listenForNetworkChanges((online) => { if (online) retryQueue(); });
    const timer = setInterval(() => retryQueue(), 15000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      stopNetwork();
      clearTimeout(holdTimer.current);
    };
    // Queue retry reads current persisted items; it is safe on an interval and on reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (count === null) return undefined;
    if (count === 0) {
      setCount(null);
      runSos();
      return undefined;
    }
    const timer = setTimeout(() => setCount((value) => value === null ? null : value - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  async function sendSmsFallback(item) {
    if (!(LOCAL_RESPONSE_NUMBER || EMERGENCY_NUMBER)) {
      setError('No local response number is configured. Your SOS is queued on this device; use your phone emergency dialer if help is needed now.');
      return;
    }
    setMessage('No connection, opening an SMS draft instead. Review it and tap Send in your SMS app.');
    try { await Linking.openURL(smsUrl(item.id, item.smsCategory || item.category || 'Other', item.location)); }
    catch { setError('The SMS app could not be opened. Use your phone’s emergency dialer and share these coordinates.'); }
  }

  async function saveQueue(item) {
    const items = await queueOfflineIncident(item);
    if (mounted.current) setQueued(items.filter((entry) => entry.userId === auth.currentUser?.uid));
    await sendSmsFallback(item);
  }

  async function sendIncident(item, routeAfterSend = true) {
    const classified = await classify(item.description || '');
    const result = { ...classified, type: item.category && item.category !== 'Auto' ? item.category : classified.type };
    const id = await createIncident({
      id: item.id,
      location: item.location,
      description: item.description || '',
      classification: result,
      anonymous: Boolean(item.anonymous),
      silent: Boolean(item.silent),
    });
    await removeQueuedIncident(id).then((items) => mounted.current && setQueued(items.filter((entry) => entry.userId === auth.currentUser?.uid)));
    if (routeAfterSend && mounted.current) {
      setNeedAddress(false);
      setBusy(false);
      setMessage(item.silent ? '' : 'Your SOS has been sent.');
      if (item.silent) setSilentIncidentId(id);
      else navigation.navigate('Incident', { id });
    }
    return id;
  }

  async function retryQueue() {
    if (!mounted.current || retrying.current || !(await hasInternetConnection())) return;
    retrying.current = true;
    try {
      const items = (await readOfflineQueue()).filter((item) => item.userId === auth.currentUser?.uid);
      for (const item of items) {
        try {
          await sendIncident(item, false);
          if (mounted.current) {
            setMessage(item.silent ? '' : `Queued SOS ${item.id} sent after connection returned.`);
            if (item.silent) setSilentIncidentId(item.id);
          }
        } catch { break; }
      }
    } finally { retrying.current = false; }
  }

  async function runSos(manualLocation, silent = false) {
    setBusy(true); setError(''); setMessage(''); setSilentIncidentId('');
    let location = manualLocation;
    if (!location) {
      try { location = await getLocation(); }
      catch {
        if (!mounted.current) return;
        setNeedAddress(true);
        setError('Could not get your location. Enter an address to continue.');
        setBusy(false);
        return;
      }
    }
    const item = {
      id: newIncidentId(),
      userId: auth.currentUser?.uid,
      location,
      description: text.trim(),
      category,
      smsCategory: category === 'Auto' ? localClassify(text).type : category,
      anonymous,
      silent,
      queuedAt: Date.now(),
    };
    try {
      if (!(await hasInternetConnection())) {
        await saveQueue(item);
        setBusy(false);
        return;
      }
      await sendIncident(item);
    } catch (e) {
      if (!mounted.current) return;
      try { await saveQueue(item); }
      catch (queueError) { setError(`Could not save the SOS for retry: ${queueError.message}. ${e.message}`); }
      setBusy(false);
    }
  }

  async function submitAddress() {
    if (!address.trim()) { setError('Enter an address first.'); return; }
    setBusy(true); setError('');
    try {
      const location = await geocodeAddress(address.trim());
      if (!location) { setError('Address not found. Try adding the city or a nearby landmark.'); setBusy(false); return; }
      await runSos(location);
    } catch (e) { setError(`Address lookup failed: ${e.message}`); setBusy(false); }
  }

  function startHold() {
    held.current = false;
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      held.current = true;
      setCount(null);
      runSos(undefined, true);
    }, 2000);
  }

  function endHold() { clearTimeout(holdTimer.current); }

  function onSosPress() {
    if (busy) return;
    if (held.current) { held.current = false; return; }
    setMessage('');
    setCount((value) => value === null ? 3 : null);
  }

  const counting = count !== null && count > 0;
  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <Text style={shared.title}>{translate('appTitle', language)}</Text>
      <Text style={shared.muted}>{translate('sosInstructions', language)}</Text>
      <TextInput
        style={[shared.input, styles.describe]}
        placeholder={translate('description', language)}
        value={text}
        onChangeText={setText}
        maxLength={1000}
        multiline
        accessibilityLabel="Describe what is happening"
      />
      <Text style={shared.muted}>{translate('dictationHint', language)}</Text>
      <Text style={shared.heading}>{translate('category', language)}</Text>
      <View style={shared.row}>
        {['Auto', ...INCIDENT_CATEGORIES].map((value) => (
          <Pressable key={value} onPress={() => setCategory(value)} style={[shared.pill, { borderColor: category === value ? colors.red : colors.border }]} accessibilityRole="button" accessibilityState={{ selected: category === value }}>
            <Text style={shared.pillText}>{translateCategory(value, language)}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={styles.toggleRow} onPress={() => setAnonymous((value) => !value)} accessibilityRole="switch" accessibilityState={{ checked: anonymous }}>
        <View style={[styles.checkbox, anonymous && styles.checked]} />
        <Text style={shared.text}>{translate('anonymous', language)}</Text>
      </Pressable>
      <View style={styles.sosWrap}>
        <Pressable
          style={[styles.sos, busy && styles.sosBusy]}
          onPress={onSosPress}
          onPressIn={startHold}
          onPressOut={endHold}
          accessibilityRole="button"
          accessibilityLabel={counting ? `Cancel SOS. Sending in ${count} seconds` : translate('sendSos', language)}
          accessibilityHint="Tap for a 3 second countdown, or hold for 2 seconds to send silently."
          accessibilityState={{ busy }}
        >
          <Text style={styles.sosText}>{busy ? '...' : counting ? String(count) : translate('sos', language)}</Text>
          <Text style={styles.sosSub}>{counting ? translate('countdown', language) : busy ? 'Sending' : translate('pressOrHold', language)}</Text>
        </Pressable>
      </View>
      {needAddress && (
        <View style={shared.card}>
          <Text style={shared.heading}>{translate('whereAreYou', language)}</Text>
          <TextInput style={shared.input} placeholder={translate('addressPlaceholder', language)} value={address} onChangeText={setAddress} accessibilityLabel={translate('whereAreYou', language)} />
          <Pressable style={shared.button} onPress={submitAddress} disabled={busy} accessibilityRole="button"><Text style={shared.buttonText}>{translate('sendSosAddress', language)}</Text></Pressable>
        </View>
      )}
      {!!message && <Text style={shared.muted} accessibilityLiveRegion="polite">{message}</Text>}
      {!!silentIncidentId && <View style={shared.card}>
        <Text style={shared.heading}>Request received</Text>
        <Text style={shared.muted}>Responders have your location. This confirmation is quiet.</Text>
        <Pressable style={shared.buttonOutline} onPress={() => navigation.navigate('Incident', { id: silentIncidentId })} accessibilityRole="button"><Text style={shared.buttonOutlineText}>View incident status</Text></Pressable>
      </View>}
      {!!error && <Text style={shared.error}>{error}</Text>}
      {queued.length > 0 && <View style={shared.card}>
        <Text style={shared.heading}>SOS waiting for a connection</Text>
        <Text style={shared.muted}>{queued.length} request(s) are stored on this device and will retry when internet returns.</Text>
        {queued.map((item) => <Text key={item.id} style={shared.muted}>{item.id} · {item.smsCategory || item.category}</Text>)}
      </View>}
      <View style={shared.row}>
        <Pressable style={[shared.buttonOutline, styles.half]} onPress={() => navigation.navigate('Contacts')} accessibilityRole="button"><Text style={shared.buttonOutlineText}>{translate('contacts', language)}</Text></Pressable>
        <Pressable style={[shared.buttonOutline, styles.half]} onPress={() => navigation.navigate('MyIncidents')} accessibilityRole="button"><Text style={shared.buttonOutlineText}>{translate('myIncidents', language)}</Text></Pressable>
      </View>
      <View style={shared.row}>
        <Pressable style={[shared.buttonOutline, styles.half]} onPress={() => navigation.navigate('SafeWalk')} accessibilityRole="button"><Text style={shared.buttonOutlineText}>{translate('safeJourney', language)}</Text></Pressable>
        <Pressable style={[shared.buttonOutline, styles.half]} onPress={() => navigation.navigate('FirstAid')} accessibilityRole="button"><Text style={shared.buttonOutlineText}>{translate('firstAid', language)}</Text></Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  describe: { minHeight: 90, textAlignVertical: 'top' },
  sosWrap: { alignItems: 'center', paddingVertical: 8 },
  sos: { width: 190, height: 190, borderRadius: 95, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', borderWidth: 8, borderColor: '#FFCDD2' },
  sosBusy: { opacity: 0.6 },
  sosText: { color: colors.white, fontSize: 56, fontWeight: '800' },
  sosSub: { color: colors.white, fontSize: 14, fontWeight: '600' },
  half: { flex: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 24, height: 24, borderRadius: 5, borderWidth: 2, borderColor: colors.red, backgroundColor: colors.white },
  checked: { backgroundColor: colors.red },
});
