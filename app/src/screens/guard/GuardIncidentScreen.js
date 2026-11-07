import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import AppMap from '../../components/AppMap';
import { advanceIncident, acceptIncident, declineIncident } from '../../services/dispatch';
import { subscribeIncident } from '../../services/incidents';
import { loadMedicalIdForIncident } from '../../services/medical';
import { getRouteForDistance } from '../../services/routing';
import { colors, markerColors, priorityColors, shared } from '../../theme';

const mapStyle = { height: 360, borderRadius: 12 };

function formatTime(value) {
  const date = value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : null);
  return date ? date.toLocaleString() : 'Just now';
}

export default function GuardIncidentScreen({ route: nav, user }) {
  const { id } = nav.params;
  const [incident, setIncident] = useState(undefined);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeError, setRouteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [medicalId, setMedicalId] = useState(null);
  const [medicalError, setMedicalError] = useState('');

  useEffect(
    () =>
      subscribeIncident(id, setIncident, (e) => {
        setIncident(null);
        setError(`Could not load incident: ${e.message}`);
      }),
    [id]
  );

  const target = incident?.userLocation || incident?.location;
  const lat = target?.lat;
  const lng = target?.lng;
  useEffect(() => {
    if (!user.location || lat == null || lng == null) return undefined;
    let cancelled = false;
    getRouteForDistance(user.location, { lat, lng })
      .then((result) => {
        if (!cancelled) {
          setRouteInfo(result);
          setRouteError('');
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setRouteInfo(null);
          setRouteError(`Route unavailable: ${e.message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user.location?.lat, user.location?.lng, lat, lng]);

  async function runAction(action, label) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(`${label}: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function openMedicalId() {
    setMedicalError('');
    try { setMedicalId(await loadMedicalIdForIncident(id)); }
    catch (e) { setMedicalError(e.message); }
  }

  if (incident === undefined) {
    return <View style={shared.center}><ActivityIndicator size="large" color={colors.red} /></View>;
  }
  if (incident === null) {
    return <View style={shared.center}><Text style={shared.error}>{error || 'Incident not found.'}</Text></View>;
  }

  const assignedToMe = (incident.assignedResponderId || incident.assignedGuardId) === user.uid;
  const markers = [
    ...(target ? [{ id: 'user', lat: target.lat, lng: target.lng, label: 'Incident location', color: markerColors.user }] : []),
    ...(user.location ? [{ id: 'responder', lat: user.location.lat, lng: user.location.lng, label: 'Your location', color: markerColors.police }] : []),
  ];
  let nextStatus = null;
  if (incident.status === 'ASSIGNED' && incident.acceptedAt) nextStatus = 'EN_ROUTE';
  if (incident.status === 'EN_ROUTE') nextStatus = 'ARRIVED';
  if (incident.status === 'ARRIVED') nextStatus = 'RESOLVED';

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={[shared.card, { borderLeftWidth: 8, borderLeftColor: priorityColors[incident.priority] || colors.red }]}>
        <Text style={shared.muted}>{incident.id} · {incident.status}</Text>
        <Text style={shared.title}>{incident.category || incident.type} · {incident.priority}</Text>
        <Text style={shared.muted}>
          {incident.address || incident.generalArea || incident.nearestLandmark || 'Location address unavailable'}
        </Text>
        {!!incident.description && <Text style={shared.text}>{incident.description}</Text>}
        {incident.anonymous && <Text style={shared.muted}>Anonymous report</Text>}
      </View>

      <View style={shared.card}>
        <Text style={shared.heading}>Incident location and route</Text>
        <AppMap style={mapStyle} markers={markers} route={routeInfo?.coords || []} center={target} />
        {!user.location && <Text style={shared.muted}>Your duty location is not available yet.</Text>}
        {routeInfo && <Text style={shared.text}>{routeInfo.distanceKm.toFixed(1)} km · about {Math.max(1, Math.round(routeInfo.durationMin))} min {routeInfo.profile === 'foot' ? 'on foot' : 'by road'}</Text>}
        {!!routeError && <Text style={shared.error}>{routeError}</Text>}
      </View>

      {!assignedToMe && <Text style={shared.error}>This incident is assigned to another responder.</Text>}
      {assignedToMe && !['RESOLVED', 'CANCELLED'].includes(incident.status) && <View style={shared.card}>
        <Text style={shared.heading}>Medical ID</Text>
        <Text style={shared.muted}>Private user details are available to the assigned responder only while this incident is open.</Text>
        {medicalId && <Text style={shared.text}>{['bloodGroup', 'allergies', 'conditions', 'medications'].map((key) => medicalId[key] ? `${key}: ${medicalId[key]}` : '').filter(Boolean).join('\n') || 'No Medical ID details saved.'}</Text>}
        {!!medicalError && <Text style={shared.error}>{medicalError}</Text>}
        <Pressable style={shared.buttonOutline} onPress={openMedicalId} accessibilityRole="button"><Text style={shared.buttonOutlineText}>{medicalId ? 'Refresh Medical ID' : 'View Medical ID'}</Text></Pressable>
      </View>}
      {assignedToMe && incident.status === 'ASSIGNED' && !incident.acceptedAt && (
        <View style={shared.row}>
          <Pressable style={[shared.button, { flex: 1 }]} onPress={() => runAction(() => acceptIncident(id), 'Could not accept')} disabled={busy} accessibilityRole="button">
            <Text style={shared.buttonText}>Accept</Text>
          </Pressable>
          <Pressable style={[shared.buttonOutline, { flex: 1 }]} onPress={() => runAction(() => declineIncident(id), 'Could not decline')} disabled={busy} accessibilityRole="button">
            <Text style={shared.buttonOutlineText}>Decline</Text>
          </Pressable>
        </View>
      )}
      {assignedToMe && nextStatus && (
        <Pressable style={shared.button} onPress={() => runAction(() => advanceIncident(id, nextStatus), `Could not set ${nextStatus}`)} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={shared.buttonText}>{nextStatus === 'EN_ROUTE' ? 'Mark En route' : nextStatus === 'ARRIVED' ? 'Mark Arrived' : 'Resolve incident'}</Text>}
        </Pressable>
      )}
      {!!error && <Text style={shared.error}>{error}</Text>}

      <View style={shared.card}>
        <Text style={shared.heading}>Incident timeline</Text>
        {(incident.timeline || []).map((event, index) => (
          <Text key={`${event.status}-${index}`} style={shared.text}>{event.status} · {formatTime(event.at)}</Text>
        ))}
        {(incident.timeline || []).length === 0 && <Text style={shared.muted}>No timeline events yet.</Text>}
      </View>
    </ScrollView>
  );
}
