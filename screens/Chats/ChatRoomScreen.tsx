import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, Button, Image, TouchableOpacity, Alert } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { ChatsStackParamList } from '../../navigation/ChatsStack';
import { collection, onSnapshot, orderBy, query, doc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { auth } from '../../firebase/config';
import { sendMessage, updateReadStatus } from '../../firebase/chatService';
import * as ImagePicker from 'expo-image-picker';
import { uploadChatImage } from '../../firebase/storageService';
import { showLocalNotification } from '../../lib/notifications';

type Message = {
  id: string;
  senderId: string;
  text?: string | null;
  imageUrl?: string | null;
  timestamp: number;
};

export default function ChatRoomScreen() {
  const route = useRoute<RouteProp<ChatsStackParamList, 'ChatRoom'>>();
  const navigation = useNavigation();
  const { chatId } = route.params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [lastReadAt, setLastReadAt] = useState<number | null>(null);
  const [isSomeoneTyping, setIsSomeoneTyping] = useState(false);
  const typingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const prevCountRef = React.useRef<number>(0);

  useEffect(() => {
    // Set title from chat doc (groupName) if available
    const chatRef = doc(db, 'chats', chatId);
    const unsubTitle = onSnapshot(chatRef, (snap) => {
      const data: any = snap.data() || {};
      if (data?.type === 'group' && data?.groupName) {
        // @ts-ignore
        navigation.setOptions?.({ title: data.groupName });
      }
    });
    const ref = collection(db, 'chats', chatId, 'messages');
    const q = query(ref, orderBy('timestamp', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setMessages(list);
      const uid = auth.currentUser?.uid;
      if (uid) updateReadStatus(chatId, uid);
      // Foreground local notification for new incoming message
      const prev = prevCountRef.current;
      if (list.length > prev) {
        const last = list[list.length - 1];
        const myUid = auth.currentUser?.uid;
        if (last && last.senderId !== myUid) {
          const body = last.text ? String(last.text) : 'Sent a photo';
          showLocalNotification('New message', body);
        }
      }
      prevCountRef.current = list.length;
    });
    return () => { unsub(); unsubTitle(); };
  }, [chatId]);

  // Listen to chat doc for my lastReadAt
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const chatRef = doc(db, 'chats', chatId);
    const unsub = onSnapshot(chatRef, (snap) => {
      const data: any = snap.data() || {};
      const rs = data.readStatus || {};
      setLastReadAt(rs[uid] ?? null);
    });
    return () => unsub();
  }, [chatId]);

  // Typing indicator listeners
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    const typingRef = collection(db, 'chats', chatId, 'typing');
    const unsub = onSnapshot(typingRef, (snap) => {
      let someone = false;
      snap.forEach((d) => {
        const data: any = d.data();
        if (d.id !== uid && data?.typing) someone = true;
      });
      setIsSomeoneTyping(someone);
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
        data={(function buildData() {
          if (!lastReadAt) return messages;
          const idx = messages.findIndex((m) => m.timestamp > (lastReadAt as number));
          if (idx <= 0) return messages;
          const arr: any[] = [...messages];
          arr.splice(idx, 0, { id: 'unread-divider', divider: true });
          return arr;
        })()}
        keyExtractor={(item) => item.id}
        renderItem={({ item }: any) => {
          if (item.divider) {
            return (
              <View style={{ alignItems: 'center', marginVertical: 8 }}>
                <Text style={{ color: '#666' }}>New messages</Text>
              </View>
            );
          }
          return (
            <View style={{ marginBottom: 8, alignSelf: item.senderId === auth.currentUser?.uid ? 'flex-end' : 'flex-start' }}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={{ width: 200, height: 200, borderRadius: 8 }} />
              ) : (
                <Text style={{ backgroundColor: '#eee', borderRadius: 8, padding: 8 }}>{item.text}</Text>
              )}
            </View>
          );
        }}
      />
      {isSomeoneTyping ? (
        <Text style={{ textAlign: 'center', color: '#888', marginBottom: 4 }}>Typing…</Text>
      ) : null}
      <View style={{ flexDirection: 'row', padding: 8, gap: 8, alignItems: 'center' }}>
        <TouchableOpacity onPress={onPickImage} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
          <Text>📎</Text>
        </TouchableOpacity>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            const uid = auth.currentUser?.uid;
            if (!uid) return;
            // mark typing true and debounce to false
            const typingDoc = doc(db, 'chats', chatId, 'typing', uid);
            import('firebase/firestore').then(({ setDoc }) => setDoc(typingDoc, { typing: true, updatedAt: Date.now() }, { merge: true }));
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => {
              import('firebase/firestore').then(({ setDoc }) => setDoc(typingDoc, { typing: false, updatedAt: Date.now() }, { merge: true }));
            }, 1500);
          }}
          placeholder="Type a message"
          style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
        />
        <Button title="Send" onPress={onSend} />
      </View>
    </View>
  );
}


