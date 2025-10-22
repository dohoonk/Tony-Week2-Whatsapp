import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, FlatList, TouchableOpacity, Alert, Image } from 'react-native';
import { auth } from '../../firebase/config';
import { getUserProfile } from '../../firebase/userService';
import { listIncomingRequests, listOutgoingRequests, listFriends, sendFriendRequest, acceptFriendRequest, declineFriendRequest, cancelOutgoingRequest } from '../../firebase/friendService';
import GroupChatModal from './GroupChatModal';
import { collection, getDocs, query, where, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useNavigation } from '@react-navigation/native';
import { openDirectChat } from '../../firebase/chatService';

export default function FriendsScreen() {
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
        const online = data?.online === true || data?.state === 'online' || recent(data?.lastChanged) || recent(data?.lastSeen);
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
        const online = u?.status === 'online' || u?.online === true || recent(u?.lastSeen);
        if (online !== undefined) {
          setPresenceMap((m) => ({ ...m, [userId]: !!online }));
        }
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
    const normalized = email.trim().toLowerCase();
    // Try emailLower first
    let q1 = query(ref, where('emailLower', '==', normalized));
    let snap = await getDocs(q1);
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      return { uid: docSnap.id, ...docSnap.data() } as any;
    }
    // Fallback: some profiles may only have 'email'
    let q2 = query(ref, where('email', '==', normalized));
    snap = await getDocs(q2);
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      return { uid: docSnap.id, ...docSnap.data() } as any;
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
        <Text style={{ fontSize: 22, fontWeight: '600' }}>Friends</Text>
        <Button title="Start Group Chat" onPress={() => setGroupVisible(true)} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 12 }}>Add friend by email</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <TextInput
          value={emailToAdd}
          onChangeText={setEmailToAdd}
          placeholder="friend@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
        />
        <Button title="Send" onPress={onSendRequest} disabled={loading} />
      </View>

      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Incoming Requests</Text>
      <FlatList
        data={incoming}
        keyExtractor={(item) => item.id}
        extraData={presenceMap}
        ListEmptyComponent={<Text style={{ color: '#666' }}>No incoming</Text>}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Image
                source={item?.profile?.photoURL ? { uri: item.profile.photoURL } : undefined}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ddd' }}
              />
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontWeight: '600' }}>{item?.profile?.displayName ?? item.fromUid}</Text>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: presenceMap[item.fromUid] ? '#34C759' : '#D1D5DB' }} />
                </View>
                {item?.profile?.email ? (
                  <Text style={{ color: '#666' }}>{item.profile.email}</Text>
                ) : null}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Accept" onPress={async () => { await acceptFriendRequest(item.id, item.fromUid, uid!); refresh(); }} />
              <Button title="Decline" onPress={async () => { await declineFriendRequest(item.id); refresh(); }} />
            </View>
          </View>
        )}
      />

      <Text style={{ fontSize: 18, fontWeight: '600', marginVertical: 8 }}>Outgoing Requests</Text>
      <FlatList
        data={outgoing}
        keyExtractor={(item) => item.id}
        extraData={presenceMap}
        ListEmptyComponent={<Text style={{ color: '#666' }}>No outgoing</Text>}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Image
                source={item?.profile?.photoURL ? { uri: item.profile.photoURL } : undefined}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ddd' }}
              />
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontWeight: '600' }}>{item?.profile?.displayName ?? item.toUid}</Text>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: presenceMap[item.toUid] ? '#34C759' : '#D1D5DB' }} />
                </View>
                {item?.profile?.email ? (
                  <Text style={{ color: '#666' }}>{item.profile.email}</Text>
                ) : null}
              </View>
            </View>
            <Button title="Cancel" onPress={async () => { await cancelOutgoingRequest(item.id); refresh(); }} />
          </View>
        )}
      />

      <Text style={{ fontSize: 18, fontWeight: '600', marginVertical: 8 }}>Friends</Text>
      <FlatList
        data={friends}
        keyExtractor={(item) => item.id}
        extraData={presenceMap}
        ListEmptyComponent={<Text style={{ color: '#666' }}>No friends yet</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={async () => {
              if (!uid) return;
              const chatId = await openDirectChat(uid, item.friendUid);
              // Navigate to nested ChatRoom inside the Chats tab stack
              navigation.navigate('Chats' as never, { screen: 'ChatRoom', params: { chatId } } as never);
            }}
            style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, alignItems: 'center' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Image
                source={item?.profile?.photoURL ? { uri: item.profile.photoURL } : undefined}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ddd' }}
              />
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontWeight: '600' }}>{item?.profile?.displayName ?? item.friendUid}</Text>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: presenceMap[item.friendUid] ? '#34C759' : '#D1D5DB' }} />
                </View>
                {item?.profile?.email ? (
                  <Text style={{ color: '#666' }}>{item.profile.email}</Text>
                ) : null}
              </View>
            </View>
            <Text style={{ color: '#0066cc' }}>Start Chat</Text>
          </TouchableOpacity>
        )}
      />
      <GroupChatModal
        visible={groupVisible}
        onClose={() => setGroupVisible(false)}
        onCreated={(chatId) => navigation.navigate('Chats' as never, { screen: 'ChatRoom', params: { chatId } } as never)}
      />
    </View>
  );
}


