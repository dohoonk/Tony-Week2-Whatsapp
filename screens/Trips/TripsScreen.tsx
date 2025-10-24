import React from 'react';
import { View, Text } from 'react-native';

export default function TripsScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '600' }}>Trips</Text>
      <View style={{ height: 8 }} />
      <Text style={{ textAlign: 'center', color: '#666' }}>
        Trip planning features will appear here. Use the AI tools in chats to
        generate itineraries, polls, and reminders.
      </Text>
    </View>
  );
}


