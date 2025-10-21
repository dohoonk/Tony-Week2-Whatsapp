import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { auth } from '../../firebase/config';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/config';

type Chat = {
  id: string;
  members: string[];
  lastMessage?: string;
  lastMessageAt?: number;
  type: 'direct' | 'group';
  groupName?: string;
};

export default function ChatsScreen() {
  const [chats, setChats] = useState<Chat[]>([]);
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    const ref = collection(db, 'chats');
    const q = query(ref, where('members', 'array-contains', uid), orderBy('lastMessageAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list: Chat[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setChats(list);
    });
    return () => unsub();
  }, [uid]);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <FlatList
        data={chats}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#666' }}>No chats yet</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
            <Text style={{ fontWeight: '600' }}>{item.type === 'group' ? item.groupName ?? 'Group' : 'Direct chat'}</Text>
            {item.lastMessage ? <Text style={{ color: '#666' }}>{item.lastMessage}</Text> : null}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}


