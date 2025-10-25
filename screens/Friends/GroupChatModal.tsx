import React, { useEffect, useState } from 'react';
import { Modal, View, Text, FlatList, TouchableOpacity, TextInput, Button, Image, Alert } from 'react-native';
import { listFriends } from '../../firebase/friendService';
import { getUserProfile } from '../../firebase/userService';
import { auth } from '../../firebase/config';
import * as ImagePicker from 'expo-image-picker';
import { createGroupChat } from '../../firebase/chatService';
import { uploadGroupPhoto } from '../../firebase/storageService';

export default function GroupChatModal({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (chatId: string) => void }) {
  const uid = auth.currentUser?.uid!;
  const [friends, setFriends] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [groupName, setGroupName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const raw = await listFriends(uid);
      const uidSet = Array.from(new Set(raw.map((f: any) => f.friendUid)));
      const entries = await Promise.all(uidSet.map(async (id) => [id, await getUserProfile(id)] as const));
      const map = Object.fromEntries(entries);
      setFriends(raw.map((f: any) => ({ ...f, profile: map[f.friendUid] })));
      setSelected({});
      setGroupName('');
      setPhotoUri(null);
    })();
  }, [visible]);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission required', 'Allow photo library access.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!res.canceled) setPhotoUri(res.assets[0].uri);
  };

  const onCreate = async () => {
    try {
      setLoading(true);
      const memberIds = [uid, ...friends.filter((f) => selected[f.friendUid]).map((f) => f.friendUid)];
      if (memberIds.length < 3) {
        Alert.alert('Pick at least 2 friends');
        return;
      }
      if (memberIds.length > 100) {
        Alert.alert('Too many members', 'Maximum group size is 100');
        return;
      }
      let photoURL: string | undefined = undefined;
      const chatId = await createGroupChat(memberIds, groupName || undefined, undefined);
      if (photoUri) {
        photoURL = await uploadGroupPhoto(chatId, photoUri);
      }
      if (photoURL) {
        // update chat with photoURL
        const { doc, updateDoc, db } = await import('firebase/firestore');
        await updateDoc(doc(db as any, 'chats', chatId), { groupPhotoURL: photoURL });
      }
      onCreated(chatId);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 12 }}>New Group</Text>
        <TouchableOpacity onPress={pickPhoto} style={{ alignSelf: 'center', marginBottom: 12 }}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={{ width: 96, height: 96, borderRadius: 48 }} />
          ) : (
            <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center' }}>
              <Text>Pick photo</Text>
            </View>
          )}
        </TouchableOpacity>
        <TextInput
          value={groupName}
          onChangeText={setGroupName}
          placeholder="Group name (optional)"
          style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 12 }}
        />
        <Text style={{ fontWeight: '600', marginBottom: 8 }}>Pick friends</Text>
        <FlatList
          data={friends}
          keyExtractor={(item) => item.friendUid}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setSelected((s) => ({ ...s, [item.friendUid]: !s[item.friendUid] }))}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, alignItems: 'center' }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Image
                  source={item?.profile?.photoURL ? { uri: item.profile.photoURL } : undefined}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ddd' }}
                />
                <View>
                  <Text style={{ fontWeight: '600' }}>{item?.profile?.displayName ?? item.friendUid}</Text>
                  {item?.profile?.email ? (
                    <Text style={{ color: '#666' }}>{item.profile.email}</Text>
                  ) : null}
                </View>
              </View>
              <Text>{selected[item.friendUid] ? '✓' : ''}</Text>
            </TouchableOpacity>
          )}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
          <Button title="Cancel" onPress={onClose} />
          <Button title={loading ? 'Creating…' : 'Create'} onPress={onCreate} disabled={loading} />
        </View>
      </View>
    </Modal>
  );
}


