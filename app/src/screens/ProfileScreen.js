import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { normalizePhoneNumber, updateOwnProfile } from '../services/auth';
import { supportedLanguageOptions, translate } from '../services/i18n';
import { RESPONDER_TYPES, applyToRespond } from '../services/responders';
import { confirmPhoneCode, sendPhoneCode } from '../services/phoneVerification';
import { colors, shared } from '../theme';

export default function ProfileScreen({ user, profile, onSignOut, navigation }) {
  const [name, setName] = useState(profile.name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [language, setLanguage] = useState(profile.language || 'en');
  const [responderType, setResponderType] = useState(profile.responderApplication?.type || 'volunteer');
  const [responderNote, setResponderNote] = useState(profile.responderApplication?.note || '');
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [applicationMessage, setApplicationMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneMessage, setPhoneMessage] = useState('');

  useEffect(() => {
    setName(profile.name || '');
    setPhone(profile.phone || '');
    setLanguage(profile.language || 'en');
    setResponderType(profile.responderApplication?.type || 'volunteer');
    setResponderNote(profile.responderApplication?.note || '');
  }, [profile.name, profile.phone, profile.language, profile.responderApplication?.type, profile.responderApplication?.note]);

  async function save() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await updateOwnProfile(user.uid, { name, phone, language, previousPhone: profile.phone || '' });
      setSaved(true);
    } catch (e) {
      setError(e.message || 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  }

  async function requestPhoneCode() {
    setPhoneBusy(true);
    setError('');
    setPhoneMessage('');
    try {
      const normalized = normalizePhoneNumber(phone);
      await sendPhoneCode(normalized);
      setPhone(normalized);
      setPhoneCodeSent(true);
      setPhoneMessage('Verification code sent by SMS.');
    } catch (e) { setError(e.message || 'Could not send a verification code.'); }
    finally { setPhoneBusy(false); }
  }

  async function verifyPhoneCode() {
    setPhoneBusy(true);
    setError('');
    setPhoneMessage('');
    try {
      const normalized = normalizePhoneNumber(phone);
      await confirmPhoneCode(normalized, phoneCode.trim());
      setPhone(normalized);
      setPhoneCodeSent(false);
      setPhoneCode('');
      setPhoneMessage('Phone number verified.');
    } catch (e) { setError(e.message || 'The verification code could not be confirmed.'); }
    finally { setPhoneBusy(false); }
  }

  let normalizedPhone = '';
  try { normalizedPhone = normalizePhoneNumber(phone); } catch { /* the form displays validation when saved */ }
  const phoneVerified = Boolean(profile.phoneVerified && normalizedPhone && profile.phone === normalizedPhone);

  async function submitResponderApplication() {
    setApplicationBusy(true);
    setError('');
    setApplicationMessage('');
    try {
      await applyToRespond({ uid: user.uid, responderType, note: responderNote });
      setApplicationMessage('Application submitted. An administrator must verify you before responder duties are enabled.');
    } catch (e) {
      setError(e.message || 'Could not submit the responder application.');
    } finally {
      setApplicationBusy(false);
    }
  }

  const userRole = ['user', 'student'].includes(profile.role);

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={shared.card}>
        <Text style={shared.title}>{translate('profile', language)}</Text>
        <Text style={shared.muted}>{profile.email || user.email}</Text>
        <Text style={shared.heading}>Account role</Text>
        <Text style={shared.text}>{({ student: 'user', guard: 'responder' })[profile.role] || profile.role}</Text>
        <Pressable style={shared.buttonOutline} onPress={() => navigation.navigate('Privacy')} accessibilityRole="button">
          <Text style={shared.buttonOutlineText}>Privacy details</Text>
        </Pressable>
        <TextInput style={shared.input} placeholder="Name" value={name} onChangeText={setName} accessibilityLabel="Profile name" />
        <TextInput
          style={shared.input}
          placeholder="Phone number with country code"
          value={phone}
          onChangeText={(value) => { setPhone(value); setPhoneCodeSent(false); setPhoneMessage(''); }}
          keyboardType="phone-pad"
          accessibilityLabel="Profile phone number"
        />
        <Text style={shared.muted}>{phoneVerified ? 'Phone number verified' : 'Phone verification is optional. Use the country code, for example +1 555 555 5555.'}</Text>
        {!phoneVerified && <>
          <Pressable style={shared.buttonOutline} onPress={requestPhoneCode} disabled={phoneBusy || !phone.trim()} accessibilityRole="button">
            {phoneBusy && !phoneCodeSent ? <ActivityIndicator color={colors.red} /> : <Text style={shared.buttonOutlineText}>Send optional SMS verification code</Text>}
          </Pressable>
          {phoneCodeSent && <>
            <TextInput style={shared.input} placeholder="SMS verification code" value={phoneCode} onChangeText={setPhoneCode} keyboardType="number-pad" maxLength={10} accessibilityLabel="SMS verification code" />
            <Pressable style={shared.buttonOutline} onPress={verifyPhoneCode} disabled={phoneBusy || !phoneCode.trim()} accessibilityRole="button">
              {phoneBusy ? <ActivityIndicator color={colors.red} /> : <Text style={shared.buttonOutlineText}>Verify phone number</Text>}
            </Pressable>
          </>}
          {!!phoneMessage && <Text style={{ color: colors.green }}>{phoneMessage}</Text>}
        </>}
        <Text style={shared.heading}>{translate('language', language)}</Text>
        <View style={shared.row}>
          {supportedLanguageOptions().map((option) => (
            <Pressable key={option.code} style={{ ...shared.pill, borderColor: language === option.code ? colors.red : colors.border }} onPress={() => setLanguage(option.code)} accessibilityRole="button" accessibilityState={{ selected: language === option.code }}>
              <Text style={shared.pillText}>{option.name}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={shared.buttonOutline} onPress={() => navigation.navigate('MedicalId')} accessibilityRole="button">
          <Text style={shared.buttonOutlineText}>Medical ID</Text>
        </Pressable>
        <Pressable style={shared.buttonOutline} onPress={() => navigation.navigate('FirstAid')} accessibilityRole="button">
          <Text style={shared.buttonOutlineText}>{translate('firstAid', language)}</Text>
        </Pressable>
        {userRole && <View style={[shared.card, { borderColor: colors.border }]}>
          <Text style={shared.heading}>Apply to become a responder</Text>
          <Text style={shared.muted}>An administrator verifies your credentials before dispatch can assign incidents to you.</Text>
          {profile.responderApplication?.status === 'pending' && <Text style={shared.muted}>Application pending review.</Text>}
          {profile.responderApplication?.status === 'rejected' && <Text style={shared.error}>Application was not approved. You may update your note and apply again.</Text>}
          <View style={shared.row}>
            {RESPONDER_TYPES.map((type) => <Pressable key={type} style={{ ...shared.pill, borderColor: responderType === type ? colors.red : colors.border }} onPress={() => setResponderType(type)} accessibilityRole="button" accessibilityState={{ selected: responderType === type }}><Text style={shared.pillText}>{type}</Text></Pressable>)}
          </View>
          <TextInput style={shared.input} placeholder="ID or certification note" value={responderNote} onChangeText={setResponderNote} maxLength={500} multiline accessibilityLabel="Responder certification note" />
          {applicationMessage ? <Text style={{ color: colors.green }}>{applicationMessage}</Text> : null}
          <Pressable style={shared.buttonOutline} onPress={submitResponderApplication} disabled={applicationBusy || profile.responderApplication?.status === 'pending'} accessibilityRole="button">
            {applicationBusy ? <ActivityIndicator color={colors.red} /> : <Text style={shared.buttonOutlineText}>{profile.responderApplication?.status === 'pending' ? 'Application pending' : 'Submit application'}</Text>}
          </Pressable>
        </View>}
        {!!error && <Text style={shared.error}>{error}</Text>}
        {saved && <Text style={{ color: colors.green }}>Profile saved.</Text>}
        <Pressable style={shared.button} onPress={save} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={shared.buttonText}>{translate('saveProfile', language)}</Text>}
        </Pressable>
        <Pressable style={shared.buttonOutline} onPress={onSignOut} accessibilityRole="button">
          <Text style={shared.buttonOutlineText}>{translate('signOut', language)}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
