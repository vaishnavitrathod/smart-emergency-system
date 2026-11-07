import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { shared } from '../theme';

export default function PrivacyScreen() {
  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={shared.card}>
        <Text style={shared.title}>Privacy</Text>
        <Text style={shared.text}>Location is collected in the foreground while an incident is open, a safe-journey timer is active, or a verified responder is on duty.</Text>
        <Text style={shared.text}>Your account details, saved contacts, incident descriptions, and locations are stored in the configured Firebase project. Contacts are never copied into an incident record. Phone numbers are optional; phone OTP is available only when the operator configures Twilio Verify.</Text>
        <Text style={shared.text}>An SOS that cannot reach Firestore is temporarily queued on this device until it can be retried.</Text>
        <Text style={shared.text}>Anonymous reports keep your name, email, phone, and account ID private from responders. Administrators can view identity for safety follow-up.</Text>
        <Text style={shared.text}>Anyone with a public tracking link can view status, general area, and exact current location while the incident is open; after closure, the last shared location remains until purged. Closed incident locations and expired safe-journey/responder location data are purged after the configured retention period (30 days by default).</Text>
        <Text style={shared.text}>Medical ID is private. The owner, an assigned responder, or authorized operations staff can retrieve it only while the incident is open.</Text>
        <Text style={shared.text}>Smart Emergency Response supports, but does not replace, official emergency services. Call the configured local emergency number directly for immediate danger.</Text>
      </View>
    </ScrollView>
  );
}
