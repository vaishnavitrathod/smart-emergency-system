import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { auth } from '../../firebase';
import { subscribeMyIncidents } from '../../services/incidents';
import { colors, priorityColors, shared, statusColors } from '../../theme';

export default function MyIncidentsScreen({ navigation }) {
  const [incidents, setIncidents] = useState(null);
  const [error, setError] = useState('');

  useEffect(
    () =>
      subscribeMyIncidents(
        auth.currentUser.uid,
        setIncidents,
        (e) => {
          setIncidents([]);
          setError(`Could not load your incidents: ${e.message}`);
        }
      ),
    []
  );

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={shared.card}>
        <Text style={shared.title}>My incidents</Text>
        <Text style={shared.muted}>Follow your current and past reports.</Text>
      </View>
      {incidents === null && <ActivityIndicator size="large" color={colors.red} />}
      {!!error && <Text style={shared.error}>{error}</Text>}
      {incidents?.length === 0 && !error && <Text style={shared.muted}>You have not sent an SOS yet.</Text>}
      {incidents?.map((incident) => (
        <Pressable
          key={incident.id}
          style={[shared.card, { borderLeftWidth: 8, borderLeftColor: priorityColors[incident.priority] || colors.red }]}
          onPress={() => navigation.navigate('Incident', { id: incident.id })}
          accessibilityRole="button"
          accessibilityLabel={`Open ${incident.type} incident ${incident.id}`}
        >
          <Text style={shared.muted}>{incident.id} · {new Date(incident.createdMs).toLocaleString()}</Text>
          <Text style={shared.heading}>{incident.type} · {incident.priority}</Text>
          <Text style={{ color: statusColors[incident.status] || colors.muted }}>{incident.status}</Text>
          <Text style={shared.muted}>
            {incident.nearestLandmark
              ? `Near ${incident.nearestLandmark}, about ${incident.landmarkDistanceM} m`
              : 'Location address unavailable'}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
