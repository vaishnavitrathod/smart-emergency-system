import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, Vibration, View } from 'react-native';
import * as Location from 'expo-location';
import { getGuardQueue, acceptIncident, declineIncident } from '../../services/dispatch';
import { subscribeGuardAssignments } from '../../services/incidents';
import { haversineMeters } from '../../services/locations';
import { setGuardDuty, setGuardLocation, subscribeUser } from '../../services/users';
import { colors, priorityColors, shared } from '../../theme';

const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function rankQueue(queue, location) {
  return [...queue].sort((a, b) => {
    const priority = (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4);
    if (priority) return priority;
    const aDistance = location && a.location ? haversineMeters(location, a.location) : Number.POSITIVE_INFINITY;
    const bDistance = location && b.location ? haversineMeters(location, b.location) : Number.POSITIVE_INFINITY;
    return aDistance - bDistance;
  });
}

function nearestLine(incident) {
  return incident.nearestLandmark
    ? `Near ${incident.nearestLandmark}, about ${incident.landmarkDistanceM} m`
    : 'Location address unavailable';
}

export default function GuardHomeScreen({ navigation, user }) {
  const [guard, setGuard] = useState(user);
  const [assignments, setAssignments] = useState(null);
  const [queue, setQueue] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bannerIncident, setBannerIncident] = useState(null);
  const lastAssignmentId = useRef(null);
  const onDuty = Boolean(guard?.onDuty);
  const activeAssignment = assignments?.[0] || null;
  const sortedQueue = rankQueue(queue || [], guard?.location);

  useEffect(() => subscribeUser(user.uid, setGuard, (e) => setError(`Could not load responder status: ${e.message}`)), [user.uid]);

  useEffect(() => {
    let cancelled = false;
    let subscription = null;
    if (!onDuty) return undefined;
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          setError('Location permission is needed while you are on duty. Duty was turned off.');
          await setGuardDuty(user.uid, false).catch(() => undefined);
          return;
        }
        const watch = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 0 },
          (position) => {
            const location = { lat: position.coords.latitude, lng: position.coords.longitude };
            setGuardLocation(user.uid, location).catch((e) => setError(`Could not update responder location: ${e.message}`));
          }
        );
        if (cancelled) watch.remove();
        else subscription = watch;
      } catch (e) {
        setError(`Could not start duty location tracking: ${e.message}`);
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [onDuty, user.uid]);

  useEffect(
    () =>
      subscribeGuardAssignments(user.uid, setAssignments, (e) => {
        setAssignments([]);
        setError(`Could not load assignments: ${e.message}`);
      }),
    [user.uid]
  );

  useEffect(() => {
    if (!onDuty) {
      setQueue([]);
      return undefined;
    }
    let active = true;
    const loadQueue = () =>
      getGuardQueue()
        .then((result) => {
          if (active) {
            setQueue(result.incidents || []);
            setError('');
          }
        })
        .catch((e) => {
          if (active) {
            setQueue([]);
            setError(`Could not load the incident queue: ${e.message}`);
          }
        });
    loadQueue();
    const timer = setInterval(loadQueue, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [onDuty]);

  useEffect(() => {
    const id = activeAssignment?.id || null;
    if (id && id !== lastAssignmentId.current) {
      setBannerIncident(activeAssignment);
      if (Platform.OS !== 'web') Vibration.vibrate([0, 500, 250, 500]);
    }
    lastAssignmentId.current = id;
  }, [activeAssignment?.id]);

  async function toggleDuty() {
    setBusyId('duty');
    setError('');
    setNotice('');
    try {
      await setGuardDuty(user.uid, !onDuty);
      setNotice(onDuty ? 'Duty turned off. Location updates have stopped.' : 'Duty turned on. Your location will update while you are on duty.');
    } catch (e) {
      setError(`Could not update duty status: ${e.message}`);
    } finally {
      setBusyId('');
    }
  }

  async function accept(id) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await acceptIncident(id);
      setNotice('Incident accepted. Open the assignment for the route and next steps.');
    } catch (e) {
      setError(`Could not accept the incident: ${e.message}`);
    } finally {
      setBusyId('');
    }
  }

  async function decline(id) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await declineIncident(id);
      setNotice('Assignment declined and returned to dispatch.');
    } catch (e) {
      setError(`Could not decline the assignment: ${e.message}`);
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
        <View style={shared.card}>
          <Text style={shared.title}>Duty status</Text>
          <Text style={shared.text}>{onDuty ? 'On duty' : 'Off duty'}</Text>
          {guard?.location && (
            <Text style={shared.muted}>Last location: {guard.location.lat.toFixed(5)}, {guard.location.lng.toFixed(5)}</Text>
          )}
          <Pressable style={shared.button} onPress={toggleDuty} disabled={busyId === 'duty'} accessibilityRole="button">
            {busyId === 'duty' ? <ActivityIndicator color={colors.white} /> : <Text style={shared.buttonText}>{onDuty ? 'Go off duty' : 'Go on duty'}</Text>}
          </Pressable>
          <Text style={shared.muted}>Location is shared with dispatch while you are on duty.</Text>
        </View>

        {!!error && <Text style={shared.error}>{error}</Text>}
        {!!notice && <Text style={shared.muted}>{notice}</Text>}

        {assignments === null ? (
          <ActivityIndicator size="large" color={colors.red} />
        ) : activeAssignment ? (
          <Pressable
            style={[shared.card, { borderLeftWidth: 8, borderLeftColor: priorityColors[activeAssignment.priority] || colors.red }]}
            onPress={() => navigation.navigate('GuardIncident', { id: activeAssignment.id })}
            accessibilityRole="button"
          >
            <Text style={shared.title}>Active assignment</Text>
            <Text style={shared.heading}>{activeAssignment.id} · {activeAssignment.type}</Text>
            <Text style={shared.text}>Status: {activeAssignment.status}</Text>
            <Text style={shared.muted}>{nearestLine(activeAssignment)}</Text>
            {!!activeAssignment.description && <Text style={shared.text}>{activeAssignment.description}</Text>}
            <Text style={shared.buttonOutlineText}>Open incident</Text>
          </Pressable>
        ) : (
          <View style={shared.card}>
            <Text style={shared.heading}>No active assignment</Text>
            <Text style={shared.muted}>Your current assignments will appear here.</Text>
          </View>
        )}

        <View style={shared.card}>
          <Text style={shared.title}>Dispatch queue</Text>
          {!onDuty && <Text style={shared.muted}>Go on duty to receive incidents.</Text>}
          {onDuty && queue === null && <ActivityIndicator color={colors.red} />}
          {onDuty && queue?.length === 0 && <Text style={shared.muted}>No unassigned incidents right now.</Text>}
          {onDuty && sortedQueue.map((incident) => {
            const distance = guard?.location && incident.location ? haversineMeters(guard.location, incident.location) : null;
            return (
              <View key={incident.id} style={[shared.card, { borderLeftWidth: 6, borderLeftColor: priorityColors[incident.priority] || colors.red }]}>
                <Text style={shared.heading}>{incident.type} · {incident.priority}</Text>
                <Text style={shared.muted}>{incident.id} · {incident.status}</Text>
                <Text style={shared.muted}>{nearestLine(incident)}</Text>
                {distance !== null && <Text style={shared.muted}>About {Math.round(distance)} m from your last location</Text>}
                {!!incident.description && <Text style={shared.text}>{incident.description}</Text>}
                <Pressable style={shared.button} onPress={() => accept(incident.id)} disabled={busyId === incident.id} accessibilityRole="button">
                  {busyId === incident.id ? <ActivityIndicator color={colors.white} /> : <Text style={shared.buttonText}>Accept incident</Text>}
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <Modal visible={Boolean(bannerIncident)} animationType="slide" onRequestClose={() => setBannerIncident(null)}>
        <View style={[shared.center, { backgroundColor: colors.redDark }]}>
          <Text style={{ color: colors.white, fontSize: 30, fontWeight: '800', textAlign: 'center' }}>New SOS assignment</Text>
          <Text style={{ color: colors.white, fontSize: 20, textAlign: 'center' }}>
            {bannerIncident?.type} · {bannerIncident?.priority}
          </Text>
          <Text style={{ color: colors.white, textAlign: 'center' }}>{bannerIncident?.id}</Text>
          <Pressable
            style={[shared.buttonOutline, { minWidth: 200 }]}
            onPress={() => {
              const id = bannerIncident?.id;
              setBannerIncident(null);
              if (id) navigation.navigate('GuardIncident', { id });
            }}
            accessibilityRole="button"
          >
            <Text style={shared.buttonOutlineText}>Open assignment</Text>
          </Pressable>
          <Pressable onPress={() => setBannerIncident(null)} accessibilityRole="button">
            <Text style={{ color: colors.white, padding: 12 }}>Dismiss</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
