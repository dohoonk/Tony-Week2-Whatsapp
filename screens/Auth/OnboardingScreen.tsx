import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';
import { upsertUserProfile } from '../../firebase/userService';
import { auth } from '../../firebase/config';

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const onSave = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (!displayName.trim()) {
      Alert.alert('Please enter a name');
      return;
    }
    try {
      setLoading(true);
      await upsertUserProfile(uid, { displayName, email: auth.currentUser?.email ?? undefined });
      onDone();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '600', marginBottom: 16 }}>Set up your profile</Text>
      <TextInput
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Display name"
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 16 }}
      />
      <Button title={loading ? 'Saving...' : 'Continue'} onPress={onSave} disabled={loading} />
    </View>
  );
}


