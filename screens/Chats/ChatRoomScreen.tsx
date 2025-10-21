import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, Button } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { ChatsStackParamList } from '../../navigation/ChatsStack';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { auth } from '../../firebase/config';
import { sendMessage, updateReadStatus } from '../../firebase/chatService';

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

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        contentContainerStyle={{ padding: 16 }}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ marginBottom: 8, alignSelf: item.senderId === auth.currentUser?.uid ? 'flex-end' : 'flex-start' }}>
            <Text style={{ backgroundColor: '#eee', borderRadius: 8, padding: 8 }}>{item.text ?? '📷'}</Text>
          </View>
        )}
      />
      <View style={{ flexDirection: 'row', padding: 8, gap: 8 }}>
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


