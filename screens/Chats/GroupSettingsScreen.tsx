import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, Image, TouchableOpacity, Alert } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { ChatsStackParamList } from '../../navigation/ChatsStack';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import * as ImagePicker from 'expo-image-picker';
import { uploadGroupPhoto } from '../../firebase/storageService';

export default function GroupSettingsScreen() {
  const route = useRoute<RouteProp<ChatsStackParamList, 'GroupSettings'>>();
  const navigation = useNavigation();
  const { chatId } = route.params;
  const [name, setName] = useState('');
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const ref = doc(db, 'chats', chatId);
      const snap = await getDoc(ref);
      const d: any = snap.data() || {};
      setName(d?.groupName ?? '');
      setPhotoURL(d?.groupPhotoURL ?? null);
    })();
  }, [chatId]);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission required', 'Allow photo library access.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!res.canceled) setLocalUri(res.assets[0].uri);
  };

  const onSave = async () => {
    try {
      setSaving(true);
      const ref = doc(db, 'chats', chatId);
      let url = photoURL;
      if (localUri) {
        url = await uploadGroupPhoto(chatId, localUri);
      }
      await updateDoc(ref, { groupName: name || null, groupPhotoURL: url || null });
      // @ts-ignore
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 12 }}>Group Settings</Text>
      <TouchableOpacity onPress={pickPhoto} style={{ alignSelf: 'center', marginBottom: 12 }}>
        {localUri || photoURL ? (
          <Image source={{ uri: localUri ?? photoURL! }} style={{ width: 96, height: 96, borderRadius: 48 }} />
        ) : (
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#eee' }} />
        )}
      </TouchableOpacity>
      <Text>Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Group name"
        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 16 }}
      />
      <Button title={saving ? 'Saving…' : 'Save'} onPress={onSave} disabled={saving} />
    </View>
  );
}


