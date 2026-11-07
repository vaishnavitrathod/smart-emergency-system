import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import AppMap from '../../components/AppMap';
import { CAMPUS_CENTER } from '../../config';
import {
  LOCATION_TYPES,
  addCampusLocation,
  deleteCampusLocation,
  subscribeCampusLocations,
  updateCampusLocation,
} from '../../services/locations';
import { colors, shared } from '../../theme';

const mapStyle = { height: 360, borderRadius: 12 };

export default function LocationsScreen() {
  const [locations, setLocations] = useState(null);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('gate');
  const [coordinates, setCoordinates] = useState(CAMPUS_CENTER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    try {
      return subscribeCampusLocations(setLocations, (e) => {
        setLocations([]);
        setError(`Could not load configured response sites: ${e.message}`);
      });
    } catch (e) {
      setLocations([]);
      setError(`Could not load configured response sites: ${e.message}`);
      return () => undefined;
    }
  }, []);

  function selectLocation(location) {
    setSelected(location);
    setName(location.name);
    setType(location.type);
    setCoordinates({ lat: location.lat, lng: location.lng });
    setError('');
    setNotice('');
  }

  function startNew() {
    setSelected(null);
    setName('');
    setType('gate');
    setCoordinates(CAMPUS_CENTER);
    setError('');
    setNotice('Tap the map to set the new location coordinates.');
  }

  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = { name, type, ...coordinates };
      if (selected) await updateCampusLocation(selected.id, value);
      else await addCampusLocation(value);
      setSelected(null);
      setName('');
      setType('gate');
      setNotice('Response site saved.');
    } catch (e) {
      setError(e.message || 'Could not save response site.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(location) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await deleteCampusLocation(location.id);
      if (selected?.id === location.id) startNew();
      setNotice(`${location.name} removed.`);
    } catch (e) {
      setError(e.message || 'Could not delete response site.');
    } finally {
      setBusy(false);
    }
  }

  const markers = [
    ...(locations || []).map((location) => ({
      id: location.id,
      lat: location.lat,
      lng: location.lng,
      label: `${location.name} · ${location.type}`,
      color: location.id === selected?.id ? colors.red : colors.blue,
    })),
    { id: 'draft', lat: coordinates.lat, lng: coordinates.lng, label: selected?.name || 'New location', color: colors.green },
  ];

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={shared.card}>
        <Text style={shared.title}>Configured response sites</Text>
        <Text style={shared.muted}>Add local landmarks or support sites for your response network. Nearby hospital, police, and fire searches work without these records.</Text>
        <AppMap style={mapStyle} center={CAMPUS_CENTER} markers={markers} onPress={setCoordinates} />
        <Text style={shared.muted}>Selected coordinates: {coordinates.lat.toFixed(6)}, {coordinates.lng.toFixed(6)}</Text>
        <TextInput style={shared.input} placeholder="Site name" value={name} onChangeText={setName} accessibilityLabel="Response site name" />
        <Text style={shared.heading}>Type</Text>
        <View style={shared.row}>
          {LOCATION_TYPES.map((item) => {
            const active = item === type;
            return (
              <Pressable
                key={item}
                style={[shared.pill, { borderColor: colors.red }, active && { backgroundColor: colors.red }]}
                onPress={() => setType(item)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[shared.pillText, { color: active ? colors.white : colors.red }]}>{item}</Text>
              </Pressable>
            );
          })}
        </View>
        {!!error && <Text style={shared.error}>{error}</Text>}
        {!!notice && <Text style={shared.muted}>{notice}</Text>}
        <Pressable style={shared.button} onPress={save} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={shared.buttonText}>{selected ? 'Save changes' : 'Add location'}</Text>}
        </Pressable>
        <View style={shared.row}>
          <Pressable style={[shared.buttonOutline, { flex: 1 }]} onPress={startNew} disabled={busy} accessibilityRole="button">
            <Text style={shared.buttonOutlineText}>New location</Text>
          </Pressable>
        </View>
      </View>

      {locations === null && <ActivityIndicator size="large" color={colors.red} />}
      {locations?.length === 0 && <Text style={shared.muted}>No response sites have been added.</Text>}
      {locations?.map((location) => (
        <View key={location.id} style={[shared.card, shared.row, { justifyContent: 'space-between' }]}>
          <Pressable onPress={() => selectLocation(location)} accessibilityRole="button" accessibilityLabel={`Edit ${location.name}`}>
            <Text style={shared.heading}>{location.name}</Text>
            <Text style={shared.muted}>{location.type} · {location.lat.toFixed(5)}, {location.lng.toFixed(5)}</Text>
          </Pressable>
          <View style={shared.row}>
            <Pressable style={shared.buttonOutline} onPress={() => selectLocation(location)} accessibilityRole="button">
              <Text style={shared.buttonOutlineText}>Edit</Text>
            </Pressable>
            <Pressable style={shared.buttonOutline} onPress={() => remove(location)} disabled={busy} accessibilityRole="button">
              <Text style={shared.buttonOutlineText}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
