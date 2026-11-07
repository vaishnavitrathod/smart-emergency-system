import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import AppMap from '../components/AppMap';
import StatusPills from '../components/StatusPills';
import { EMERGENCY_NUMBER, LOCAL_RESPONSE_NUMBER, publicTrackingUrl } from '../config';
import { auth } from '../firebase';
import { getIncidentTracking } from '../services/dispatch';
import { setStatus, subscribeIncident } from '../services/incidents';
import { findNearbyHelp, nearestHelp } from '../services/places';
import { findNearbyPartners } from '../services/partners';
import { loadMedicalIdForIncident } from '../services/medical';
import { getRouteForDistance } from '../services/routing';
import { colors, markerColors, priorityColors, shared } from '../theme';

const mapStyle = { height: 320, borderRadius: 12 };
const CLOSED = new Set(['RESOLVED', 'CANCELLED']);

function open(url, onError) {
  Linking.openURL(url).catch(() => onError('Could not open that link on this device.'));
}

function formatTimelineTime(value) {
  const date = value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : null);
  return date ? date.toLocaleString() : 'Just now';
}

export default function IncidentScreen({ route: nav, role = 'student', navigation }) {
  const { id } = nav.params;
  const [incident, setIncident] = useState(undefined);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [nearby, setNearby] = useState({ loading: true, target: null, route: null, results: { hospital: [], police: [], fire: [] }, error: '' });
  const [nearbyPartners, setNearbyPartners] = useState([]);
  const [medicalId, setMedicalId] = useState(null);
  const [medicalError, setMedicalError] = useState('');
  const [guardTracking, setGuardTracking] = useState({ location: null, name: '', route: null, loading: false, error: '' });
  const liveLocation = incident?.userLocation || incident?.location || null;
  const liveLocationRef = useRef(liveLocation);
  liveLocationRef.current = liveLocation;

  useEffect(
    () =>
      subscribeIncident(id, setIncident, (e) => {
        setIncident(null);
        setError(`Could not load the incident: ${e.message}`);
      }),
    [id]
  );

  const originalLat = incident?.location?.lat;
  const originalLng = incident?.location?.lng;
  useEffect(() => {
    if (originalLat == null || originalLng == null) return undefined;
    let cancelled = false;
    setNearby({ loading: true, target: null, route: null, results: { hospital: [], police: [], fire: [] }, error: '' });
    (async () => {
      try {
        const results = await findNearbyHelp(originalLat, originalLng);
        if (cancelled) return;
        const target = nearestHelp(results, incident?.category || incident?.type);
        if (!target) {
          setNearby({ loading: false, target: null, route: null, results, error: '' });
          return;
        }
        setNearby({ loading: true, target, route: null, results, error: '' });
        try {
          const found = await getRouteForDistance({ lat: originalLat, lng: originalLng }, target);
          if (!cancelled) setNearby({ loading: false, target, route: found, results, error: '' });
        } catch (e) {
          if (!cancelled) setNearby({ loading: false, target, route: null, results, error: `Route unavailable: ${e.message}` });
        }
      } catch (e) {
        if (!cancelled) setNearby({ loading: false, target: null, route: null, results: { hospital: [], police: [], fire: [] }, error: `Could not search nearby emergency services: ${e.message}` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [originalLat, originalLng, incident?.category, incident?.type, attempt]);

  useEffect(() => {
    if (originalLat == null || originalLng == null) return undefined;
    let cancelled = false;
    findNearbyPartners({ lat: originalLat, lng: originalLng }, incident?.category || incident?.type)
      .then((rows) => { if (!cancelled) setNearbyPartners(rows.slice(0, 5)); })
      .catch(() => { if (!cancelled) setNearbyPartners([]); });
    return () => { cancelled = true; };
  }, [originalLat, originalLng, incident?.category, incident?.type]);

  useEffect(() => {
    const assignedResponderId = incident?.assignedResponderId || incident?.assignedGuardId;
    if (!assignedResponderId || CLOSED.has(incident.status)) {
      setGuardTracking({ location: null, name: incident?.assignedResponderName || incident?.assignedGuardName || '', route: null, loading: false, error: '' });
      return undefined;
    }
    let cancelled = false;
    let refreshing = false;
    setGuardTracking((value) => ({ ...value, loading: true, error: '' }));
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const tracking = await getIncidentTracking(id);
        if (cancelled) return;
        const location = tracking.guardLocation;
        const destination = liveLocationRef.current;
        let route = null;
        let routeError = '';
        if (location && destination) {
          try {
          route = await getRouteForDistance(location, destination);
          } catch (e) {
            routeError = `Route unavailable: ${e.message}`;
          }
        }
        if (!cancelled) {
          setGuardTracking({ location, name: tracking.responderName || tracking.guardName || incident.assignedResponderName || incident.assignedGuardName || 'Responder', route, loading: false, error: routeError });
        }
      } catch (e) {
        if (!cancelled) setGuardTracking((value) => ({ ...value, loading: false, error: `Could not update responder tracking: ${e.message}` }));
      } finally {
        refreshing = false;
      }
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, incident?.assignedResponderId, incident?.assignedGuardId, incident?.assignedResponderName, incident?.assignedGuardName, incident?.status]);

  async function onStatus(status) {
    setError('');
    try {
      await setStatus(id, status);
    } catch (e) {
      setError(`Could not update the incident: ${e.message}`);
    }
  }

  async function loadMedicalId() {
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

  const userMarker = liveLocation
    ? [{ id: 'user', lat: liveLocation.lat, lng: liveLocation.lng, label: 'Incident location', color: markerColors.user }]
    : [];
  const responseMarkers = [
    ...userMarker,
    ...(guardTracking.location
      ? [{ id: 'responder', lat: guardTracking.location.lat, lng: guardTracking.location.lng, label: guardTracking.name || 'Responder', color: markerColors.police }]
      : []),
  ];
  const nearbyMarkers = [
    ...userMarker,
    ...Object.values(nearby.results || {}).flat().map((place) => ({
      id: place.id, lat: place.lat, lng: place.lng,
      label: `${place.kind}: ${place.name}`,
      color: place.kind === 'hospital' ? markerColors.hospital : place.kind === 'police' ? markerColors.police : '#F57C00',
    })),
  ];
  const isOwner = ['user', 'student'].includes(role) && Boolean(auth.currentUser?.uid);
  const openIncident = !CLOSED.has(incident.status);
  const trackingUrl = publicTrackingUrl(id);

  async function shareTracking() {
    if (!trackingUrl) {
      setError('Set EXPO_PUBLIC_TRACKING_BASE_URL to share the public tracking page.');
      return;
    }
    try {
      if (Platform.OS === 'web' && navigator.clipboard?.writeText) await navigator.clipboard.writeText(trackingUrl);
      else await Share.share({ message: trackingUrl, url: trackingUrl });
      setError('');
    } catch (e) { setError(`Could not share the tracking link: ${e.message}`); }
  }

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={[shared.card, { borderLeftWidth: 8, borderLeftColor: priorityColors[incident.priority] || colors.red }]}>
        <Text style={shared.muted}>{incident.id} · {incident.status}</Text>
        <Text style={shared.muted}>{incident.address || incident.generalArea || incident.nearestLandmark || 'Location address unavailable'}</Text>
        <Text style={shared.title}>{incident.category || incident.type} emergency · {incident.priority}</Text>
        {!!incident.description && <Text style={shared.text}>{incident.description}</Text>}
        <Text style={[shared.heading, { color: colors.redDark }]}>{incident.recommendedAction}</Text>
        {!!LOCAL_RESPONSE_NUMBER && isOwner && (
          <Pressable style={shared.buttonOutline} onPress={() => open(`tel:${LOCAL_RESPONSE_NUMBER}`, setError)} accessibilityRole="button">
            <Text style={shared.buttonOutlineText}>Call local response line</Text>
          </Pressable>
        )}
        {!!EMERGENCY_NUMBER && <Pressable style={shared.button} onPress={() => open(`tel:${EMERGENCY_NUMBER}`, setError)} accessibilityRole="button" accessibilityLabel={`Call ${EMERGENCY_NUMBER}`}>
          <Text style={shared.buttonText}>Call emergency services · {EMERGENCY_NUMBER}</Text>
        </Pressable>}
      </View>

      {(incident.assignedResponderId || incident.assignedGuardId) && (
        <View style={shared.card}>
          <Text style={shared.heading}>Assigned responder</Text>
          <Text style={shared.text}>{incident.assignedResponderName || incident.assignedGuardName || guardTracking.name || 'A responder'} · {incident.status}</Text>
          <AppMap style={mapStyle} markers={responseMarkers} route={guardTracking.route?.coords || []} center={liveLocation} />
          {guardTracking.loading && !guardTracking.location && <ActivityIndicator color={colors.red} />}
          {guardTracking.location && guardTracking.route && (
            <Text style={shared.text}>
              About {Math.max(1, Math.round(guardTracking.route.durationMin))} min {guardTracking.route.profile === 'foot' ? 'on foot' : 'by road'} · {guardTracking.route.distanceKm.toFixed(1)} km
            </Text>
          )}
          {!guardTracking.location && <Text style={shared.muted}>Waiting for the responder's live location.</Text>}
          {!!guardTracking.error && <Text style={shared.error}>{guardTracking.error}</Text>}
          <Text style={shared.muted}>Responder location and route estimate refresh every 15 seconds.</Text>
        </View>
      )}

      <View style={shared.card}>
        <Text style={shared.heading}>Nearby emergency services</Text>
        <Text style={shared.muted}>Locations come from OpenStreetMap and may be incomplete. Call the official local emergency number for urgent help.</Text>
        <AppMap style={mapStyle} markers={nearbyMarkers} route={nearby.route?.coords || []} center={liveLocation} />
        {nearby.loading && <ActivityIndicator color={colors.red} />}
        {nearby.loading && !nearby.target && <Text style={shared.muted}>Searching OpenStreetMap for nearby hospitals, police, and fire stations…</Text>}
        {!nearby.loading && !nearby.target && !nearby.error && <Text style={shared.muted}>No nearby emergency services were found.</Text>}
        {!!nearby.error && <Text style={shared.error}>{nearby.error}</Text>}
        {!nearby.loading && (nearby.error || !nearby.target) && (
          <Pressable style={shared.buttonOutline} onPress={() => setAttempt((value) => value + 1)} accessibilityRole="button">
            <Text style={shared.buttonOutlineText}>Retry nearby search</Text>
          </Pressable>
        )}
        {nearby.target && (
          <Text style={shared.text}>
            {nearby.target.name}
            {nearby.route
              ? ` · ${nearby.route.distanceKm.toFixed(1)} km · about ${Math.max(1, Math.round(nearby.route.durationMin))} min ${nearby.route.profile === 'foot' ? 'on foot' : 'by road'}`
              : ` · ${nearby.target.distanceKm.toFixed(1)} km away`}
          </Text>
        )}
        {Object.entries(nearby.results || {}).map(([kind, places]) => <View key={kind} style={{ gap: 4 }}>
          <Text style={shared.heading}>{({ hospital: 'Hospitals', police: 'Police stations', fire: 'Fire stations' })[kind]}</Text>
          {places.slice(0, 3).map((place) => <Text key={place.id} style={shared.text}>{place.name} · {place.distanceKm.toFixed(1)} km</Text>)}
          {!places.length && <Text style={shared.muted}>No nearby {kind === 'fire' ? 'fire stations' : `${kind} services`} found in the map data.</Text>}
        </View>)}
      </View>

      {!!nearbyPartners.length && <View style={shared.card}>
        <Text style={shared.heading}>Local support partners</Text>
        {nearbyPartners.map((partner) => <Text key={partner.id} style={shared.text}>{partner.name} · {partner.type} · {partner.distanceKm.toFixed(1)} km{partner.phone ? ` · ${partner.phone}` : ''}</Text>)}
      </View>}

      {(isOwner || ['responder', 'guard', 'operator', 'admin'].includes(role)) && openIncident && <View style={shared.card}>
        <Text style={shared.heading}>Medical ID for responders</Text>
        <Text style={shared.muted}>Your Medical ID is private. It is shown only to an assigned responder or authorized operations staff while this incident is open.</Text>
        {medicalId && <Text style={shared.text}>{['bloodGroup', 'allergies', 'conditions', 'medications'].map((key) => medicalId[key] ? `${key}: ${medicalId[key]}` : '').filter(Boolean).join('\n') || 'No Medical ID details saved.'}</Text>}
        {!!medicalError && <Text style={shared.error}>{medicalError}</Text>}
        <Pressable style={shared.buttonOutline} onPress={loadMedicalId} accessibilityRole="button"><Text style={shared.buttonOutlineText}>{medicalId ? 'Refresh Medical ID' : 'Load Medical ID'}</Text></Pressable>
      </View>}

      {isOwner && (
        <View style={shared.card}>
          <Text style={shared.heading}>Emergency contacts</Text>
          <Text style={shared.muted}>Contact notification: {incident.contactSmsMode || 'pending'}</Text>
          {incident.contactSmsMode === 'sent' && <Text style={shared.text}>SMS sent to {incident.contactSmsCount || 0} saved contact(s).</Text>}
          {incident.contactSmsMode === 'none' && <Text style={shared.muted}>No emergency contacts are saved. Add contacts in Contacts.</Text>}
          {incident.contactSmsMode === 'mock' && <Text style={shared.muted}>Mock mode is active. Configure TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, and PUBLIC_TRACKING_BASE_URL on the backend to send SMS.</Text>}
          {incident.contactSmsMode === 'failed' && <Text style={shared.error}>At least one contact SMS could not be sent. Contact them directly.</Text>}
          <Pressable style={shared.buttonOutline} onPress={() => navigation.navigate('Contacts')} accessibilityRole="button">
            <Text style={shared.buttonOutlineText}>Manage saved contacts</Text>
          </Pressable>
          {!!trackingUrl && <Pressable style={shared.button} onPress={shareTracking} accessibilityRole="button"><Text style={shared.buttonText}>Share public tracking link</Text></Pressable>}
          {!trackingUrl && <Text style={shared.muted}>Public tracking URL is not configured.</Text>}
        </View>
      )}

      <View style={shared.card}>
        <Text style={shared.heading}>Status</Text>
        <Text style={shared.text}>{incident.status}</Text>
        {!isOwner && <StatusPills status={incident.status} onChange={onStatus} />}
        {isOwner && openIncident && (
          <Pressable style={shared.buttonOutline} onPress={() => onStatus('CANCELLED')} accessibilityRole="button" accessibilityLabel="Cancel this incident as a false alarm">
            <Text style={shared.buttonOutlineText}>Cancel as false alarm</Text>
          </Pressable>
        )}
        {!!error && <Text style={shared.error}>{error}</Text>}
      </View>

      <View style={shared.card}>
        <Text style={shared.heading}>Incident timeline</Text>
        {(incident.timeline || []).map((entry, index) => (
          <Text key={`${entry.status}-${index}`} style={shared.text}>{entry.status} · {formatTimelineTime(entry.at)}</Text>
        ))}
        {(incident.timeline || []).length === 0 && <Text style={shared.muted}>No timeline events yet.</Text>}
      </View>
    </ScrollView>
  );
}
