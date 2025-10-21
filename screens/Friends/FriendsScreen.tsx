import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, FlatList, TouchableOpacity, Alert } from 'react-native';
import { auth } from '../../firebase/config';
import { getUserProfile } from '../../firebase/userService';
import { listIncomingRequests, listOutgoingRequests, listFriends, sendFriendRequest, acceptFriendRequest, declineFriendRequest, cancelOutgoingRequest } from '../../firebase/friendService';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase/config';

export default function FriendsScreen() {
  const [emailToAdd, setEmailToAdd] = useState('');
  const [incoming, setIncoming] = useState<any[]>([]);
  const [outgoing, setOutgoing] = useState<any[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const uid = auth.currentUser?.uid;

  const refresh = async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const [inc, out, fr] = await Promise.all([
        listIncomingRequests(uid),
        listOutgoingRequests(uid),
        listFriends(uid),
      ]);
      setIncoming(inc);
      setOutgoing(out);
      setFriends(fr);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [uid]);

  const findUserByEmail = async (email: string) => {
    const ref = collection(db, 'users');
    const q = query(ref, where('email', '==', email.trim().toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const docSnap = snap.docs[0];
    return { uid: docSnap.id, ...docSnap.data() } as any;
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
      <Text style={{ fontSize: 22, fontWeight: '600', marginBottom: 12 }}>Add friend by email</Text>
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
        ListEmptyComponent={<Text style={{ color: '#666' }}>No incoming</Text>}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
            <Text>{item.fromUid}</Text>
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
        ListEmptyComponent={<Text style={{ color: '#666' }}>No outgoing</Text>}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
            <Text>{item.toUid}</Text>
            <Button title="Cancel" onPress={async () => { await cancelOutgoingRequest(item.id); refresh(); }} />
          </View>
        )}
      />

      <Text style={{ fontSize: 18, fontWeight: '600', marginVertical: 8 }}>Friends</Text>
      <FlatList
        data={friends}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={{ color: '#666' }}>No friends yet</Text>}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
            <Text>{item.friendUid}</Text>
          </View>
        )}
      />
    </View>
  );
}


