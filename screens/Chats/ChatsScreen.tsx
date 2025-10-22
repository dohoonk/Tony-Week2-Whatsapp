import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChatsStackParamList } from '../../navigation/ChatsStack';
import { auth } from '../../firebase/config';
import { collection, onSnapshot, query, where, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Image } from 'react-native';
import { formatLastMessageTime } from '../../lib/utils/formatTimestamp';

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
  const navigation = useNavigation<NativeStackNavigationProp<ChatsStackParamList>>();

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

  const [partnerCache, setPartnerCache] = useState<Record<string, any>>({});
  const ensurePartner = async (partnerId: string) => {
    if (partnerCache[partnerId]) return partnerCache[partnerId];
    const uref = doc(db, 'users', partnerId);
    const usnap = await getDoc(uref);
    const data = usnap.exists() ? usnap.data() : null;
    setPartnerCache((c) => ({ ...c, [partnerId]: data }));
    return data;
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <FlatList
        data={chats}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#666' }}>No chats yet</Text>}
        renderItem={({ item }) => {
          let title = item.type === 'group' ? item.groupName ?? 'Group' : 'Direct chat';
          let avatar: any = null;
          if (item.type === 'direct' && uid) {
            const partnerId = item.members.find((m) => m !== uid)!;
            const partner = partnerCache[partnerId];
            if (partner) {
              title = partner.displayName || title;
              avatar = partner.photoURL || null;
            } else {
              ensurePartner(partnerId);
            }
          }
          return (
            <TouchableOpacity
              style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center', gap: 12 }}
              onPress={() => navigation.navigate('ChatRoom', { chatId: item.id })}
            >
              {avatar ? (
                <Image source={{ uri: avatar }} style={{ width: 40, height: 40, borderRadius: 20 }} />
              ) : (
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#eee' }} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600' }}>{title}</Text>
                {item.lastMessage ? <Text style={{ color: '#666' }} numberOfLines={1}>{item.lastMessage}</Text> : null}
              </View>
              <Text style={{ color: '#666', marginLeft: 8 }}>{formatLastMessageTime(item.lastMessageAt)}</Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}


