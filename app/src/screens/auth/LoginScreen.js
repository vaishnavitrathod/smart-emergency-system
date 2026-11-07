import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { signIn } from '../../services/auth';
import { colors, shared } from '../../theme';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
    } catch (e) {
      setError(e.message || 'Could not sign in. Check your connection and credentials.');
      setBusy(false);
    }
  }

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content} keyboardShouldPersistTaps="handled">
      <View style={shared.card}>
        <Text style={shared.title}>Smart Emergency Response</Text>
        <Text style={shared.muted}>Sign in with your account.</Text>
        <TextInput
          style={shared.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          accessibilityLabel="Email"
        />
        <TextInput
          style={shared.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          accessibilityLabel="Password"
        />
        {!!error && <Text style={shared.error}>{error}</Text>}
        <Pressable style={shared.button} onPress={submit} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={shared.buttonText}>Sign in</Text>}
        </Pressable>
        <Pressable style={shared.buttonOutline} onPress={() => navigation.navigate('Register')} accessibilityRole="button">
          <Text style={shared.buttonOutlineText}>Create an account</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
