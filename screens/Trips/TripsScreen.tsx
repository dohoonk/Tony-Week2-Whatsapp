import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { auth, db } from '../../firebase/config';
import { collection, onSnapshot, query, where, orderBy, updateDoc, doc, deleteDoc } from 'firebase/firestore';

type Reminder = {
  id: string;
  chatId: string;
  title: string;
  dueAt?: number | { toMillis?: () => number } | null;
  status?: 'scheduled' | 'notified' | 'completed' | 'expired';
};

type Trip = {
  id: string;
  chatId: string;
  title?: string | null;
  notes?: string | null;
  members?: string[];
};

export default function TripsScreen() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [localShift, setLocalShift] = useState<Record<string, number>>({}); // reminderId -> ms delta
  const [trips, setTrips] = useState<Trip[]>([]);
  const [userCache, setUserCache] = useState<Record<string, any>>({});
  const nav = useNavigation<any>();

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = collection(db, 'reminders');
    const qy = query(ref, where('members', 'array-contains', uid));
    const unsub = onSnapshot(qy, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any[];
      setReminders(rows);
    });
    return () => unsub();
  }, []);

  // Load trips for user
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = collection(db, 'trips');
    const qy = query(ref, where('members', 'array-contains', uid));
    const unsub = onSnapshot(qy, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any[];
      setTrips(rows);
    });
    return () => unsub();
  }, []);

  const ensureUser = async (uid: string) => {
    if (userCache[uid]) return userCache[uid];
    const { getDoc, doc: d } = await import('firebase/firestore');
    const snap = await getDoc(d(db, 'users', uid));
    const data = snap.exists() ? snap.data() : null;
    setUserCache((m) => ({ ...m, [uid]: data }));
    return data;
  };

  const upcoming = useMemo(() => {
    return reminders
      .filter((r) => (r.status === 'scheduled' || r.status === 'notified'))
      .slice()
      .sort((a, b) => {
        const da = typeof (a.dueAt as any)?.toMillis === 'function' ? (a.dueAt as any).toMillis() : (a.dueAt as any) ?? 0;
        const dbv = typeof (b.dueAt as any)?.toMillis === 'function' ? (b.dueAt as any).toMillis() : (b.dueAt as any) ?? 0;
        return (da || 0) - (dbv || 0);
      });
  }, [reminders]);

  const adjust = (rid: string, deltaMs: number) => {
    setLocalShift((m) => ({ ...m, [rid]: (m[rid] ?? 0) + deltaMs }));
  };

  const save = async (r: Reminder) => {
    const delta = localShift[r.id] ?? 0;
    const orig = typeof (r.dueAt as any)?.toMillis === 'function' ? (r.dueAt as any).toMillis() : (r.dueAt as any) ?? Date.now();
    const next = new Date(orig + delta).getTime();
    try {
      await updateDoc(doc(db, 'reminders', r.id), { dueAt: next, status: 'scheduled' } as any);
      setLocalShift((m) => ({ ...m, [r.id]: 0 }));
    } catch {}
  };

  const cancel = async (r: Reminder) => {
    try {
      await deleteDoc(doc(db, 'reminders', r.id));
      setLocalShift((m) => {
        const { [r.id]: _, ...rest } = m; return rest;
      });
    } catch {}
  };

  const renderItem = ({ item }: { item: Reminder }) => {
    const baseTs = typeof (item.dueAt as any)?.toMillis === 'function' ? (item.dueAt as any).toMillis() : (item.dueAt as any) ?? null;
    const shifted = baseTs !== null ? baseTs + (localShift[item.id] ?? 0) : null;
    const tsStr = shifted ? new Date(shifted).toLocaleString() : 'No time set';
    return (
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: '#F3F4F6', marginBottom: 12 }}>
        <Text style={{ fontWeight: '600' }}>{item.title || 'Reminder'}</Text>
        <Text style={{ color: '#6B7280', marginTop: 4 }}>When: {tsStr}</Text>
        <Text style={{ color: '#6B7280', marginTop: 2 }}>Status: {item.status || 'scheduled'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <TouchableOpacity onPress={() => adjust(item.id, -15 * 60 * 1000)}>
            <Text style={{ color: '#2563EB' }}>-15m</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => adjust(item.id, +15 * 60 * 1000)}>
            <Text style={{ color: '#2563EB' }}>+15m</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => save(item)}>
            <Text style={{ color: '#2563EB' }}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => cancel(item)}>
            <Text style={{ color: '#EF4444' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderTrip = ({ item }: { item: Trip }) => {
    const names = (item.members || []).map((m) => userCache[m]?.displayName || m).slice(0, 4).join(', ');
    (item.members || []).forEach((m) => { if (!userCache[m]) ensureUser(m); });
    return (
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: '#EEF2FF', marginBottom: 12 }}>
        <Text style={{ fontWeight: '600' }}>{item.title || 'Trip Plan'}</Text>
        {item.notes ? <Text style={{ color: '#374151', marginTop: 4 }} numberOfLines={3}>{item.notes}</Text> : null}
        <Text style={{ color: '#6B7280', marginTop: 6 }}>Members: {names || (item.members || []).length}</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
          <TouchableOpacity onPress={() => nav.navigate('Chats', { screen: 'ChatRoom', params: { chatId: item.chatId } })}>
            <Text style={{ color: '#2563EB' }}>Open chat</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 12 }}>Trips</Text>
      {trips.length === 0 ? (
        <Text style={{ color: '#6B7280', marginBottom: 16 }}>No trips yet. Use Plan trip in chats.</Text>
      ) : (
        <FlatList data={trips} keyExtractor={(t) => t.id} renderItem={renderTrip} style={{ marginBottom: 12 }} />
      )}

      <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 12 }}>Reminders</Text>
      {upcoming.length === 0 ? (
        <Text style={{ color: '#6B7280' }}>No reminders yet. Use AI in chats to create one.</Text>
      ) : (
        <FlatList data={upcoming} keyExtractor={(r) => r.id} renderItem={renderItem} />
      )}
    </View>
  );
}


