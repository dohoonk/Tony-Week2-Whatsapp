import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, Button, Image, TouchableOpacity, Alert } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { ChatsStackParamList } from '../../navigation/ChatsStack';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { auth } from '../../firebase/config';
import { sendMessage, updateReadStatus } from '../../firebase/chatService';
import * as ImagePicker from 'expo-image-picker';
import { uploadChatImage } from '../../firebase/storageService';

type Message = {
  id: string;
  senderId: string;
  text?: string | null;
  imageUrl?: string | null;
  timestamp: number;
};

export default function ChatRoomScreen() {
  const route = useRoute<RouteProp<ChatsStackParamList, 'ChatRoom'>>();
  const { chatId } = route.params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    const ref = collection(db, 'chats', chatId, 'messages');
    const q = query(ref, orderBy('timestamp', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setMessages(list);
      const uid = auth.currentUser?.uid;
      if (uid) updateReadStatus(chatId, uid);
    });
    return () => unsub();
  }, [chatId]);

  const onSend = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !text.trim()) return;
    await sendMessage(chatId, uid, { text: text.trim() });
    setText('');
  };

  const onPickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission required', 'Allow photo library access to send images.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!res.canceled) {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const uri = res.assets[0].uri;
      const imageUrl = await uploadChatImage(chatId, uri);
      await sendMessage(chatId, uid, { imageUrl });
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        contentContainerStyle={{ padding: 16 }}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ marginBottom: 8, alignSelf: item.senderId === auth.currentUser?.uid ? 'flex-end' : 'flex-start' }}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={{ width: 200, height: 200, borderRadius: 8 }} />
            ) : (
              <Text style={{ backgroundColor: '#eee', borderRadius: 8, padding: 8 }}>{item.text}</Text>
            )}
          </View>
        )}
      />
      <View style={{ flexDirection: 'row', padding: 8, gap: 8, alignItems: 'center' }}>
        <TouchableOpacity onPress={onPickImage} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
          <Text>📎</Text>
        </TouchableOpacity>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type a message"
          style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
        />
        <Button title="Send" onPress={onSend} />
      </View>
    </View>
  );
}


