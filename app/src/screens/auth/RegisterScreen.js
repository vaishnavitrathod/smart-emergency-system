import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ALLOWED_EMAIL_DOMAIN } from '../../config';
import { registerStudent } from '../../services/auth';
import { translate } from '../../services/i18n';
import { colors, shared } from '../../theme';

export default function RegisterScreen({ navigation }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await registerStudent({ name, email, phone, password });
    } catch (e) {
      setError(e.message || 'Could not create your account. Try again.');
      setBusy(false);
    }
  }

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content} keyboardShouldPersistTaps="handled">
      <View style={shared.card}>
        <Text style={shared.title}>{translate('account')}</Text>
        <Text style={shared.muted}>
          {ALLOWED_EMAIL_DOMAIN ? `This deployment allows accounts ending in @${ALLOWED_EMAIL_DOMAIN}.` : translate('emailDomainNote')} Responders must apply and be verified; operators and admins are assigned by an administrator.
        </Text>
        <TextInput style={shared.input} placeholder={translate('fullName')} value={name} onChangeText={setName} autoComplete="name" accessibilityLabel={translate('fullName')} />
        <TextInput
          style={shared.input}
          placeholder={translate('emailAddress')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          accessibilityLabel={translate('emailAddress')}
        />
        <TextInput
          style={shared.input}
          placeholder={translate('phoneCountry')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
          accessibilityLabel="Phone number"
        />
        <TextInput
          style={shared.input}
          placeholder={translate('passwordLength')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          accessibilityLabel="Password"
        />
        {!!error && <Text style={shared.error}>{error}</Text>}
        <Pressable style={shared.button} onPress={submit} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={shared.buttonText}>Create account</Text>}
        </Pressable>
        <Pressable style={shared.buttonOutline} onPress={() => navigation.navigate('Login')} accessibilityRole="button">
          <Text style={shared.buttonOutlineText}>Back to sign in</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
