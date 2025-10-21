import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert, Image, TouchableOpacity } from 'react-native';
import { upsertUserProfile } from '../../firebase/userService';
import { auth } from '../../firebase/config';
import * as ImagePicker from 'expo-image-picker';
import { uploadUserAvatar } from '../../firebase/storageService';

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission required', 'Allow photo library access to select an avatar.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!res.canceled) {
      setAvatarUri(res.assets[0].uri);
    }
  };

  const onSave = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (!displayName.trim()) {
      Alert.alert('Please enter a name');
      return;
    }
    try {
      setLoading(true);
      let photoURL: string | undefined = undefined;
      if (avatarUri) {
        photoURL = await uploadUserAvatar(uid, avatarUri);
      }
      const email = auth.currentUser?.email ?? undefined;
      await upsertUserProfile(uid, { displayName, photoURL, email, emailLower: email?.toLowerCase() });
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
      <TouchableOpacity onPress={pickImage} style={{ alignSelf: 'center', marginBottom: 16 }}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={{ width: 96, height: 96, borderRadius: 48 }} />
        ) : (
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center' }}>
            <Text>Pick avatar</Text>
          </View>
        )}
      </TouchableOpacity>
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


