import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Image, TouchableOpacity, Alert } from 'react-native';
import AppButton from '../../components/AppButton';
import { auth } from '../../firebase/config';
import { getUserProfile, upsertUserProfile } from '../../firebase/userService';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { signOut } from '../../firebase/authService';
import * as ImagePicker from 'expo-image-picker';
import { uploadUserAvatar } from '../../firebase/storageService';

export default function ProfileScreen() {
  const uid = auth.currentUser?.uid!;
  const [displayName, setDisplayName] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [email, setEmail] = useState('');
  const [photoURL, setPhotoURL] = useState<string | undefined>(undefined);
  const [localAvatar, setLocalAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!uid) return;
    const profile = await getUserProfile(uid);
    if (profile) {
      setDisplayName(profile.displayName ?? '');
      setStatusMessage(profile.statusMessage ?? '');
      setEmail(profile.email ?? '');
      setPhotoURL(profile.photoURL);
    }
  };

  useEffect(() => {
    load();
  }, [uid]);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission required', 'Allow photo library access to select an avatar.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!res.canceled) {
      setLocalAvatar(res.assets[0].uri);
    }
  };

  const onSave = async () => {
    try {
      setLoading(true);
      let newPhotoURL = photoURL;
      if (localAvatar) {
        newPhotoURL = await uploadUserAvatar(uid, localAvatar);
      }
      const emailLower = email ? email.trim().toLowerCase() : undefined;
      await upsertUserProfile(uid, { displayName, statusMessage, photoURL: newPhotoURL, email: email?.trim() || undefined, emailLower });
      setPhotoURL(newPhotoURL);
      setLocalAvatar(null);
      Alert.alert('Saved');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save');
    } finally {
      setLoading(false);
    }
  };

  const onLogout = async () => {
    try {
      setLoading(true);
      const now = Date.now();
      await Promise.all([
        setDoc(doc(db, 'presence', uid), { state: 'offline', online: false, lastChanged: now }, { merge: true }),
        setDoc(doc(db, 'users', uid), { status: 'offline', online: false, lastSeen: now, updatedAt: now }, { merge: true }),
      ]);
      await signOut();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to log out');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '600', marginBottom: 16 }}>Profile</Text>
      <TouchableOpacity onPress={pickImage} style={{ alignSelf: 'center', marginBottom: 16 }}>
        {localAvatar || photoURL ? (
          <Image source={{ uri: localAvatar ?? photoURL }} style={{ width: 100, height: 100, borderRadius: 50 }} />
        ) : (
          <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center' }}>
            <Text>Pick avatar</Text>
          </View>
        )}
      </TouchableOpacity>
      <Text>Name</Text>
      <TextInput
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Your name"
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 12 }}
      />
      <Text>Status</Text>
      <TextInput
        value={statusMessage}
        onChangeText={setStatusMessage}
        placeholder="Available"
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 16 }}
      />
      <Text>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 16 }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
        <AppButton title={loading ? 'Saving...' : 'Save'} onPress={onSave} disabled={loading} loading={loading} variant="primary" />
        <AppButton title="Log out" onPress={onLogout} variant="destructive" />
      </View>
    </View>
  );
}


