import React from 'react';
import { Text, View } from 'react-native';
import { colors, shared } from '../theme';

export default function BarChart({ title, rows, limit = 8 }) {
  const items = [...rows].sort((a, b) => b.value - a.value).slice(0, limit);
  const max = Math.max(1, ...items.map((row) => row.value));
  return (
    <View style={shared.card}>
      <Text style={shared.heading}>{title}</Text>
      {!items.length && <Text style={shared.muted}>No incidents in this period.</Text>}
      {items.map((row) => (
        <View key={row.label} style={{ gap: 3 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={shared.text}>{row.label}</Text><Text style={shared.muted}>{row.value}</Text></View>
          <View style={{ height: 10, backgroundColor: '#F7E2E2', borderRadius: 5 }}>
            <View style={{ height: 10, width: `${Math.max(3, (row.value / max) * 100)}%`, backgroundColor: colors.red, borderRadius: 5 }} />
          </View>
        </View>
      ))}
    </View>
  );
}
