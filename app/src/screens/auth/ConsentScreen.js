import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import StudentSafetyBar from '../../components/StudentSafetyBar';
import { shared } from '../../theme';

export default function ConsentScreen({ onAccept }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function accept() {
    setBusy(true); setError('');
    try { await onAccept(); } catch (e) { setError(`Could not save consent: ${e.message}`); }
    finally { setBusy(false); }
  }
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={shared.card}>
        <Text style={shared.title}>Before you use Smart Emergency Response</Text>
        <Text style={shared.text}>When you send an SOS, your foreground location is shared with dispatch and the assigned responder while the incident is open.</Text>
        <Text style={shared.text}>If you start a safe journey, your location is shared until you check in or the timer expires. Verified responders share their location only while on duty.</Text>
        <Text style={shared.text}>Emergency contacts are stored privately and may receive an SMS when you send an SOS or miss a safe-journey check-in. Anonymous reports hide your name from responders; administrators can view account identity when needed.</Text>
        <Text style={shared.text}>If the device is offline during an SOS, the request is temporarily stored on this device to retry when the connection returns.</Text>
        <Text style={shared.text}>Anyone with a public tracking link can see its status, general area, and current location while open; after closure, the last shared location remains until purged. Location data is purged after the configured retention period (30 days by default). Medical ID is shown only to authorized people while an incident is open.</Text>
        <Text style={shared.muted}>This app supports, but does not replace, official emergency services.</Text>
        {!!error && <Text style={shared.error}>{error}</Text>}
        <Pressable style={shared.button} onPress={accept} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={shared.buttonText}>I understand and continue</Text>}
        </Pressable>
      </View>
      </ScrollView>
      <StudentSafetyBar />
    </View>
  );
}
