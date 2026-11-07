import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { auth } from '../firebase';
import { loadMyMedicalId, saveMyMedicalId } from '../services/medical';
import { colors, shared } from '../theme';

const FIELDS = [
  ['bloodGroup', 'Blood group'],
  ['allergies', 'Allergies'],
  ['conditions', 'Medical conditions'],
  ['medications', 'Medications'],
];

export default function MedicalIdScreen() {
  const [details, setDetails] = useState({ bloodGroup: '', allergies: '', conditions: '', medications: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    loadMyMedicalId(auth.currentUser.uid)
      .then((value) => active && setDetails(value))
      .catch((e) => active && setError(`Could not load Medical ID: ${e.message}`))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  async function save() {
    setBusy(true); setError(''); setSaved(false);
    try {
      await saveMyMedicalId(auth.currentUser.uid, details);
      setSaved(true);
    } catch (e) { setError(e.message || 'Could not save Medical ID.'); }
    finally { setBusy(false); }
  }

  if (loading) return <View style={shared.center}><ActivityIndicator size="large" color={colors.red} /></View>;

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={shared.card}>
        <Text style={shared.title}>Medical ID</Text>
        <Text style={shared.muted}>Only you can edit this information. It is shared with the assigned responder or operator only while an incident is active.</Text>
        {FIELDS.map(([key, label]) => (
          <View key={key}>
            <Text style={shared.heading}>{label}</Text>
            <TextInput
              style={[shared.input, { minHeight: key === 'bloodGroup' ? undefined : 76, textAlignVertical: 'top' }]}
              value={details[key] || ''}
              onChangeText={(value) => setDetails((old) => ({ ...old, [key]: value }))}
              maxLength={1000}
              multiline={key !== 'bloodGroup'}
              accessibilityLabel={label}
            />
          </View>
        ))}
        {!!error && <Text style={shared.error}>{error}</Text>}
        {saved && <Text style={{ color: colors.green }}>Medical ID saved.</Text>}
        <Pressable style={shared.button} onPress={save} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={shared.buttonText}>Save Medical ID</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}
