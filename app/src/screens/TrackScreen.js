import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import AppMap from '../components/AppMap';
import { db } from '../firebase';
import { colors, markerColors, shared } from '../theme';

export default function TrackScreen({ incidentId }) {
  const [record, setRecord] = useState(undefined);
  const [error, setError] = useState('');

  useEffect(() => onSnapshot(
    doc(db, 'publicTracking', incidentId),
    (snapshot) => setRecord(snapshot.exists() ? snapshot.data() : null),
    (e) => { setError(e.message); setRecord(null); }
  ), [incidentId]);

  if (record === undefined) return <View style={shared.center}><ActivityIndicator color={colors.red} size="large" /></View>;
  if (!record || error) return <View style={shared.center}><Text style={shared.error}>{error || 'This tracking link is unavailable.'}</Text></View>;
  const point = record.userLocation;
  const markers = point ? [{ id: 'user', lat: point.lat, lng: point.lng, label: 'Live location', color: markerColors.user }] : [];

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={shared.card}>
        <Text style={shared.title}>Emergency response tracking</Text>
        <Text style={shared.text}>Status: {record.status}</Text>
        <Text style={shared.text}>{record.generalArea || record.nearestLandmark || 'General area unavailable'}</Text>
        {record.frozen && <Text style={shared.muted}>The incident is closed. This shows its last shared location.</Text>}
      </View>
      <AppMap style={{ height: 380, borderRadius: 12 }} markers={markers} center={point} />
      <Text style={shared.muted}>Anyone with this link can see its status, general area, and current location while the incident is open.</Text>
    </ScrollView>
  );
}
