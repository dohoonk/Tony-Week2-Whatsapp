import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import AppText from '../../components/AppText';
import EmptyState from '../../components/EmptyState';
import AppCard from '../../components/AppCard';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChatsStackParamList } from '../../navigation/ChatsStack';
import { auth } from '../../firebase/config';
import { collection, onSnapshot, query, where, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Image } from 'react-native';
import GroupAvatar from '../../components/GroupAvatar';
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
        ListEmptyComponent={<EmptyState title="No chats yet" subtitle="Start a new chat from Friends" emoji="💬" />}
        renderItem={({ item }) => {
          let title = item.type === 'group' ? item.groupName ?? 'Group' : 'Direct chat';
          let avatar: any = null;
          let groupMemberPhotos: string[] | null = null;
          if (item.type === 'direct' && uid) {
            const partnerId = item.members.find((m) => m !== uid)!;
            const partner = partnerCache[partnerId];
            if (partner) {
              title = partner.displayName || title;
              avatar = partner.photoURL || null;
            } else {
              ensurePartner(partnerId);
            }
          } else if (item.type === 'group' && uid) {
            // Auto-generate name if missing
            if (!item.groupName) {
              const others = item.members.filter((m) => m !== uid).slice(0, 3);
              Promise.all(others.map((id) => ensurePartner(id))).then((ps) => {
                const name = ps.map((p: any) => p?.displayName).filter(Boolean).join(', ');
                if (name) {
                  const { doc: d, updateDoc } = require('firebase/firestore');
                  updateDoc(d(require('../../firebase/config').db, 'chats', item.id), { groupName: name });
                }
              });
            }
            groupMemberPhotos = item.members.filter((m) => m !== uid).slice(0, 4).map((id) => partnerCache[id]?.photoURL).filter(Boolean);
            item.members.filter((m) => m !== uid).slice(0, 4).forEach((id) => {
              if (!partnerCache[id]) ensurePartner(id);
            });
          }
          return (
            <TouchableOpacity onPress={() => navigation.navigate('ChatRoom', { chatId: item.id })} activeOpacity={0.85}>
              <AppCard style={{ marginVertical: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  {item.type === 'group' ? (
                    <GroupAvatar uris={groupMemberPhotos || []} size={40} />
                  ) : avatar ? (
                    <Image source={{ uri: avatar }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                  ) : (
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#eee' }} />
                  )}
                  <View style={{ flex: 1 }}>
                    <AppText>{title}</AppText>
                    {item.lastMessage ? <AppText variant="meta" style={{ color: '#666' }} numberOfLines={1}>{item.lastMessage}</AppText> : null}
                  </View>
                  <AppText variant="meta" style={{ color: '#666', marginLeft: 8 }}>{formatLastMessageTime(item.lastMessageAt)}</AppText>
                </View>
              </AppCard>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}


