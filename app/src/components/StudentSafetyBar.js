import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { EMERGENCY_NUMBER, LOCAL_RESPONSE_NUMBER } from '../config';
import { translate } from '../services/i18n';
import { colors } from '../theme';

function call(number) {
  if (number) Linking.openURL(`tel:${number}`).catch(() => undefined);
}

export default function StudentSafetyBar({ profile }) {
  const language = profile?.language || 'en';
  return (
    <View style={{ backgroundColor: colors.redDark, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, gap: 8 }}>
      <Text style={{ color: colors.white, textAlign: 'center', fontSize: 12, fontWeight: '700' }}>
        {translate('emergencyNotice', language)} {EMERGENCY_NUMBER || 'your local emergency number'}.
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
        {LOCAL_RESPONSE_NUMBER ? (
          <Pressable onPress={() => call(LOCAL_RESPONSE_NUMBER)} style={{ borderWidth: 1, borderColor: colors.white, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }} accessibilityRole="button">
            <Text style={{ color: colors.white, fontWeight: '700' }}>{translate('localResponse', language)}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => call(EMERGENCY_NUMBER)} disabled={!EMERGENCY_NUMBER} style={{ backgroundColor: colors.white, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, opacity: EMERGENCY_NUMBER ? 1 : 0.6 }} accessibilityRole="button">
          <Text style={{ color: colors.redDark, fontWeight: '700' }}>{EMERGENCY_NUMBER ? `${translate('callEmergency', language)} · ${EMERGENCY_NUMBER}` : translate('emergencyNumberMissing', language)}</Text>
        </Pressable>
      </View>
    </View>
  );
}
