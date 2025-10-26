import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, FlatList, TouchableOpacity, Alert, Image } from 'react-native';
import { useThemeColors } from '../../lib/theme';
import AppCard from '../../components/AppCard';
import AppText from '../../components/AppText';
import FormField from '../../components/FormField';
import EmptyState from '../../components/EmptyState';
import AppButton from '../../components/AppButton';
import { auth } from '../../firebase/config';
import { getUserProfile } from '../../firebase/userService';
import { listIncomingRequests, listOutgoingRequests, listFriends, sendFriendRequest, acceptFriendRequest, declineFriendRequest, cancelOutgoingRequest } from '../../firebase/friendService';
import GroupChatModal from './GroupChatModal';
import { collection, getDocs, query, where, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useNavigation } from '@react-navigation/native';
import { openDirectChat } from '../../firebase/chatService';

export default function FriendsScreen() {
  const c = useThemeColors();
  const [emailToAdd, setEmailToAdd] = useState('');
  const [incoming, setIncoming] = useState<any[]>([]);
  const [outgoing, setOutgoing] = useState<any[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [groupVisible, setGroupVisible] = useState(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, boolean>>({});
  const presenceUnsubsRef = React.useRef<Record<string, () => void>>({});
  const userUnsubsRef = React.useRef<Record<string, () => void>>({});

  const uid = auth.currentUser?.uid;
  const navigation = useNavigation();

  const loadProfiles = async (uids: string[]) => {
    const unique = Array.from(new Set(uids.filter(Boolean)));
    const entries = await Promise.all(
      unique.map(async (id) => [id, await getUserProfile(id)])
    );
    return Object.fromEntries(entries);
  };

  const refresh = async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const [inc, out, fr] = await Promise.all([
        listIncomingRequests(uid),
        listOutgoingRequests(uid),
        listFriends(uid),
      ]);
      const uidPool = [
        ...inc.map((i: any) => i.fromUid),
        ...out.map((o: any) => o.toUid),
        ...fr.map((f: any) => f.friendUid),
      ];
      const uidToProfile = await loadProfiles(uidPool);
      setIncoming(inc.map((i: any) => ({ ...i, profile: uidToProfile[i.fromUid] })));
      setOutgoing(out.map((o: any) => ({ ...o, profile: uidToProfile[o.toUid] })));
      setFriends(fr.map((f: any) => ({ ...f, profile: uidToProfile[f.friendUid] })));
    } finally {
      setLoading(false);
    }
  };

  // Real-time listeners for friend requests and friends list
  useEffect(() => {
    if (!uid) return;
    const incQ = query(collection(db, 'friendRequests'), where('toUid', '==', uid), where('status', '==', 'pending'));
    const outQ = query(collection(db, 'friendRequests'), where('fromUid', '==', uid), where('status', '==', 'pending'));
    const frRef = collection(db, 'friends', uid, 'list');

    const unsubInc = onSnapshot(incQ, async (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const uidToProfile = await loadProfiles(rows.map((r) => r.fromUid));
      setIncoming(rows.map((r: any) => ({ ...r, profile: uidToProfile[r.fromUid] })));
    });
    const unsubOut = onSnapshot(outQ, async (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const uidToProfile = await loadProfiles(rows.map((r) => r.toUid));
      setOutgoing(rows.map((r: any) => ({ ...r, profile: uidToProfile[r.toUid] })));
    });
    const unsubFr = onSnapshot(frRef, async (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const uidToProfile = await loadProfiles(rows.map((r) => r.friendUid));
      setFriends(rows.map((r: any) => ({ ...r, profile: uidToProfile[r.friendUid] })));
    });

    return () => {
      unsubInc();
      unsubOut();
      unsubFr();
    };
  }, [uid]);

  // Smoke-test: ensure my presence doc exists when viewing Friends
  useEffect(() => {
    const writePresence = async () => {
      try {
        if (!uid) return;
        const now = Date.now();
        await setDoc(doc(db, 'presence', uid), { state: 'online', online: true, lastChanged: now }, { merge: true });
        await setDoc(doc(db, 'users', uid), { status: 'online', online: true, lastSeen: now, updatedAt: now }, { merge: true });
        if (__DEV__) console.log('Friends presence smoke-write ok');
      } catch (e) {
        if (__DEV__) console.log('Friends presence smoke-write error', (e as any)?.message || e);
      }
    };
    writePresence();
  }, [uid]);

  // Subscribe to presence for all relevant users
  useEffect(() => {
    const ids = new Set<string>();
    incoming.forEach((i: any) => ids.add(i.fromUid));
    outgoing.forEach((o: any) => ids.add(o.toUid));
    friends.forEach((f: any) => ids.add(f.friendUid));

    // Unsubscribe listeners that are no longer needed
    Object.keys(presenceUnsubsRef.current).forEach((userId) => {
      if (!ids.has(userId)) {
        presenceUnsubsRef.current[userId]?.();
        delete presenceUnsubsRef.current[userId];
      }
    });
    Object.keys(userUnsubsRef.current).forEach((userId) => {
      if (!ids.has(userId)) {
        userUnsubsRef.current[userId]?.();
        delete userUnsubsRef.current[userId];
      }
    });

    // Subscribe to new ones
    ids.forEach((userId) => {
      if (presenceUnsubsRef.current[userId]) return;
      const presenceDoc = doc(db, 'presence', userId);
      const unsub = onSnapshot(presenceDoc, (snap) => {
        const data: any = snap.data() || {};
        const recent = (ts?: number) => typeof ts === 'number' && Date.now() - ts < 120000; // 2 min window
        const hasExplicit = typeof data?.online === 'boolean' || typeof data?.state === 'string';
        const online = hasExplicit
          ? (data?.online === true || data?.state === 'online')
          : (recent(data?.lastChanged) || recent(data?.lastSeen));
        setPresenceMap((m) => ({ ...m, [userId]: !!online }));
      });
      presenceUnsubsRef.current[userId] = unsub;
    });

    // Also subscribe to users docs as a fallback/secondary signal
    ids.forEach((userId) => {
      if (userUnsubsRef.current[userId]) return;
      const uref = doc(db, 'users', userId);
      const unsub = onSnapshot(uref, (snap) => {
        const u: any = snap.data() || {};
        const recent = (ts?: number) => typeof ts === 'number' && Date.now() - ts < 120000;
        const hasExplicit = typeof u?.online === 'boolean' || typeof u?.status === 'string';
        const online = hasExplicit
          ? (u?.status === 'online' || u?.online === true)
          : recent(u?.lastSeen);
        setPresenceMap((m) => ({ ...m, [userId]: !!online }));
      });
      userUnsubsRef.current[userId] = unsub;
    });

    return () => {
      // Clean up on unmount
      Object.values(presenceUnsubsRef.current).forEach((u) => u());
      presenceUnsubsRef.current = {};
      Object.values(userUnsubsRef.current).forEach((u) => u());
      userUnsubsRef.current = {};
    };
  }, [incoming, outgoing, friends]);

  const findUserByEmail = async (email: string) => {
    const ref = collection(db, 'users');
    const raw = email.trim();
    const normalized = raw.toLowerCase();
    // 1) Primary: case-insensitive via emailLower
    let snap = await getDocs(query(ref, where('emailLower', '==', normalized)));
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      return { uid: docSnap.id, ...docSnap.data() } as any;
    }
    // 2) Exact match on email as typed (some older profiles only stored 'email')
    snap = await getDocs(query(ref, where('email', '==', raw)));
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      return { uid: docSnap.id, ...docSnap.data() } as any;
    }
    // 3) Fallback: match lowercased against 'email' if the stored value is already lowercased
    if (raw !== normalized) {
      snap = await getDocs(query(ref, where('email', '==', normalized)));
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        return { uid: docSnap.id, ...docSnap.data() } as any;
      }
    }
    return null;
  };

  const onSendRequest = async () => {
    if (!uid) return;
    if (!emailToAdd.trim()) return;
    if (emailToAdd.trim().toLowerCase() === auth.currentUser?.email?.toLowerCase()) {
      Alert.alert('You cannot add yourself');
      return;
    }
    const user = await findUserByEmail(emailToAdd);
    if (!user) {
      Alert.alert('User not found');
      return;
    }
    await sendFriendRequest(uid, user.uid);
    setEmailToAdd('');
    refresh();
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <AppText variant="title">Friends</AppText>
        <AppButton title="Start Group Chat" variant="primary" size="sm" onPress={() => setGroupVisible(true)} />
      </View>
      <AppText variant="title" style={{ fontSize: 18, marginBottom: 8 }}>Add friend by email</AppText>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'stretch', marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <FormField
            label="Email"
            value={emailToAdd}
            onChangeText={setEmailToAdd}
            placeholder="friend@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            hideLabel
          />
        </View>
        <View style={{ justifyContent: 'center' }}>
          <AppButton title="Send" onPress={onSendRequest} disabled={loading} loading={loading} variant="primary" size="sm" />
        </View>
      </View>

      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8, color: c.textStrong }}>Incoming Requests</Text>
      <FlatList
        data={incoming}
        keyExtractor={(item) => item.id}
        extraData={presenceMap}
        ListEmptyComponent={<EmptyState title="No incoming requests" emoji="📨" />}
        renderItem={({ item }) => (
          <AppCard style={{ marginVertical: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Image
                  source={item?.profile?.photoURL ? { uri: item.profile.photoURL } : undefined}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.line }}
                />
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <AppText>{item?.profile?.displayName ?? item.fromUid}</AppText>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: presenceMap[item.fromUid] ? '#34C759' : c.line }} />
                  </View>
                  {item?.profile?.email ? (
                    <AppText variant="meta" style={{ color: c.textSubtle }}>{item.profile.email}</AppText>
                  ) : null}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <AppButton title="Accept" variant="primary" size="sm" onPress={async () => { await acceptFriendRequest(item.id, item.fromUid, uid!); refresh(); }} />
                <AppButton title="Decline" variant="outline" size="sm" onPress={async () => { await declineFriendRequest(item.id); refresh(); }} />
              </View>
            </View>
          </AppCard>
        )}
      />

      <Text style={{ fontSize: 18, fontWeight: '600', marginVertical: 8, color: c.textStrong }}>Outgoing Requests</Text>
      <FlatList
        data={outgoing}
        keyExtractor={(item) => item.id}
        extraData={presenceMap}
        ListEmptyComponent={<EmptyState title="No outgoing requests" emoji="📤" />}
        renderItem={({ item }) => (
          <AppCard style={{ marginVertical: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Image
                  source={item?.profile?.photoURL ? { uri: item.profile.photoURL } : undefined}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.line }}
                />
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <AppText>{item?.profile?.displayName ?? item.toUid}</AppText>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: presenceMap[item.toUid] ? '#34C759' : c.line }} />
                  </View>
                  {item?.profile?.email ? (
                    <AppText variant="meta" style={{ color: c.textSubtle }}>{item.profile.email}</AppText>
                  ) : null}
                </View>
              </View>
              <AppButton title="Cancel" variant="outline" size="sm" onPress={async () => { await cancelOutgoingRequest(item.id); refresh(); }} />
            </View>
          </AppCard>
        )}
      />

      <Text style={{ fontSize: 18, fontWeight: '600', marginVertical: 8, color: c.textStrong }}>Friends</Text>
      <FlatList
        data={friends}
        keyExtractor={(item) => item.id}
        extraData={presenceMap}
        ListEmptyComponent={<EmptyState title="No friends yet" subtitle="Add by email to start chatting" emoji="👥" />}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={async () => {
              if (!uid) return;
              const chatId = await openDirectChat(uid, item.friendUid);
              // @ts-ignore
              navigation.navigate('Chats', { screen: 'ChatRoom', params: { chatId } });
            }}
            activeOpacity={0.85}
          >
            <AppCard style={{ marginVertical: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Image
                    source={item?.profile?.photoURL ? { uri: item.profile.photoURL } : undefined}
                    style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.line }}
                  />
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <AppText>{item?.profile?.displayName ?? item.friendUid}</AppText>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: presenceMap[item.friendUid] ? '#34C759' : c.line }} />
                    </View>
                    {item?.profile?.email ? (
                      <AppText variant="meta" style={{ color: c.textSubtle }}>{item.profile.email}</AppText>
                    ) : null}
                  </View>
                </View>
                <AppButton title="Start Chat" variant="primary" size="sm" onPress={async () => {
                  if (!uid) return;
                  const chatId = await openDirectChat(uid, item.friendUid);
                  // @ts-ignore
                  navigation.navigate('Chats', { screen: 'ChatRoom', params: { chatId } });
                }} />
              </View>
            </AppCard>
          </TouchableOpacity>
        )}
      />
      <GroupChatModal
        visible={groupVisible}
        onClose={() => setGroupVisible(false)}
        onCreated={(chatId) => {
          // @ts-ignore
          navigation.navigate('Chats', { screen: 'ChatRoom', params: { chatId } });
        }}
      />
    </View>
  );
}


