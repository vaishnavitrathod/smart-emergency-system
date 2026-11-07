import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import { FIRST_AID_PROTOCOLS } from '../services/firstAid';
import { translate } from '../services/i18n';
import { shared } from '../theme';

export default function FirstAidScreen({ profile }) {
  const [openId, setOpenId] = useState('');
  const [speechError, setSpeechError] = useState('');

  async function readProtocol(protocol) {
    setSpeechError('');
    try {
      await Speech.stop();
      Speech.speak(`${protocol.title}. ${protocol.steps.map((step, index) => `${index + 1}. ${step}`).join(' ')}`, { language: 'en-US' });
    } catch (error) {
      setSpeechError(`Read-aloud is unavailable: ${error.message}`);
    }
  }

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={shared.card}>
        <Text style={shared.title}>{translate('firstAid', profile?.language)}</Text>
        <Text style={shared.muted}>These fixed, source-linked adult first-aid steps do not replace emergency services or hands-on training. Call your configured local emergency number for a life-threatening emergency.</Text>
        <Text style={shared.muted}>{translate('firstAidEnglish', profile?.language)}</Text>
      </View>
      {!!speechError && <Text style={shared.error}>{speechError}</Text>}
      {FIRST_AID_PROTOCOLS.map((protocol) => {
        const expanded = openId === protocol.id;
        return (
          <View key={protocol.id} style={shared.card}>
            <Pressable onPress={() => setOpenId(expanded ? '' : protocol.id)} accessibilityRole="button" accessibilityState={{ expanded }}>
              <Text style={shared.heading}>{protocol.title}</Text>
            </Pressable>
            {expanded && <>
              {protocol.steps.map((step, index) => <Text key={step} style={shared.text}>{index + 1}. {step}</Text>)}
              <Text style={shared.muted}>{protocol.note}</Text>
              <Pressable style={shared.buttonOutline} onPress={() => Linking.openURL(protocol.url).catch(() => setSpeechError('Could not open the source page.'))} accessibilityRole="link">
                <Text style={shared.buttonOutlineText}>Source: {protocol.source}</Text>
              </Pressable>
              <Pressable style={shared.button} onPress={() => readProtocol(protocol)} accessibilityRole="button">
                <Text style={shared.buttonText}>Read steps aloud</Text>
              </Pressable>
            </>}
          </View>
        );
      })}
      <Pressable style={shared.buttonOutline} onPress={() => Speech.stop()} accessibilityRole="button"><Text style={shared.buttonOutlineText}>Stop read-aloud</Text></Pressable>
    </ScrollView>
  );
}
