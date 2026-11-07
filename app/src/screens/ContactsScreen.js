import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MAX_CONTACTS, addContact, removeContact, subscribeContacts } from '../services/incidents';
import { shared } from '../theme';

export default function ContactsScreen() {
  const [contacts, setContacts] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  useEffect(
    () =>
      subscribeContacts(setContacts, (e) => {
        setContacts([]);
        setError(`Could not load contacts: ${e.message}`);
      }),
    []
  );

  async function onAdd() {
    setError('');
    if ((contacts || []).length >= MAX_CONTACTS) {
      setError(`You can save up to ${MAX_CONTACTS} contacts. Remove one first.`);
      return;
    }
    if (!name.trim()) {
      setError('Enter a name.');
      return;
    }
    if (!phone.trim()) {
      setError('Enter a phone number with its country code.');
      return;
    }
    try {
      await addContact(name.trim(), phone.trim());
      setName('');
      setPhone('');
    } catch (e) {
      setError(`Could not save the contact: ${e.message}`);
    }
  }

  async function onRemove(id) {
    setError('');
    try {
      await removeContact(id);
    } catch (e) {
      setError(`Could not remove the contact: ${e.message}`);
    }
  }

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={shared.card}>
        <Text style={shared.title}>Emergency contacts</Text>
        <Text style={shared.muted}>
          Up to three contacts can receive an SMS when you send an SOS or miss a Safe Walk check-in. Messages are sent by Twilio when configured; otherwise the incident is marked mock.
        </Text>
        <TextInput
          style={shared.input}
          placeholder="Name"
          value={name}
          onChangeText={setName}
          accessibilityLabel="Contact name"
        />
        <TextInput
          style={shared.input}
          placeholder="Phone number with country code"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          accessibilityLabel="Contact phone number"
        />
        {!!error && <Text style={shared.error}>{error}</Text>}
        <Pressable style={shared.button} onPress={onAdd} accessibilityRole="button">
          <Text style={shared.buttonText}>Add contact</Text>
        </Pressable>
      </View>

      {contacts === null && <ActivityIndicator size="large" />}
      {contacts && contacts.length === 0 && <Text style={shared.muted}>No contacts saved yet.</Text>}
      {contacts &&
        contacts.map((c) => (
          <View key={c.id} style={[shared.card, shared.row, { justifyContent: 'space-between' }]}>
            <View>
              <Text style={shared.heading}>{c.name}</Text>
              <Text style={shared.muted}>{c.phone}</Text>
            </View>
            <Pressable
              style={shared.buttonOutline}
              onPress={() => onRemove(c.id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${c.name}`}
            >
              <Text style={shared.buttonOutlineText}>Remove</Text>
            </Pressable>
          </View>
        ))}
    </ScrollView>
  );
}
