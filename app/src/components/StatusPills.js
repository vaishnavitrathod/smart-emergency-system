import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { STATUS_TRANSITIONS } from '../services/incidents';
import { shared, statusColors } from '../theme';

// Show the current state and only the next valid status actions.
export default function StatusPills({ status, onChange }) {
  const statuses = [status, ...(STATUS_TRANSITIONS[status] || [])];
  return (
    <View style={shared.row}>
      {statuses.map((s) => {
        const selected = s === status;
        return (
          <Pressable
            key={s}
            style={[shared.pill, { borderColor: statusColors[s] }, selected && { backgroundColor: statusColors[s] }]}
            onPress={() => !selected && onChange(s)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Set status ${s}`}
          >
            <Text style={[shared.pillText, { color: selected ? '#FFFFFF' : statusColors[s] }]}>{s}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
