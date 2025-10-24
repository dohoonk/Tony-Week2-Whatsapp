import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, TextInput, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { TripsStackParamList } from '../../navigation/TripsStack';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
  version?: number;
  startDate?: number | { toMillis?: () => number } | null;
  endDate?: number | { toMillis?: () => number } | null;
  archived?: boolean;
};

export default function TripsScreen() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [localShift, setLocalShift] = useState<Record<string, number>>({}); // reminderId -> ms delta
  const [trips, setTrips] = useState<Trip[]>([]);
  const [userCache, setUserCache] = useState<Record<string, any>>({});
  const [editTrip, setEditTrip] = useState<Trip | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editStart, setEditStart] = useState<string>(''); // MM/DD/YYYY
  const [editEnd, setEditEnd] = useState<string>('');
  const nav = useNavigation<NativeStackNavigationProp<TripsStackParamList>>();

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

  // Load trips for user (doc id may be chatId in single-trip-per-chat mode)
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
          <TouchableOpacity onPress={async () => { try { await updateDoc(doc(db, 'reminders', item.id), { status: 'completed' } as any); } catch {} }}>
            <Text style={{ color: '#2563EB' }}>Mark completed</Text>
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
    if ((item as any)?.archived) return null;
    const names = (item.members || []).map((m) => userCache[m]?.displayName || m).slice(0, 4).join(', ');
    (item.members || []).forEach((m) => { if (!userCache[m]) ensureUser(m); });
    const startTs = typeof (item.startDate as any)?.toMillis === 'function' ? (item.startDate as any).toMillis() : (item.startDate as any) ?? null;
    const endTs = typeof (item.endDate as any)?.toMillis === 'function' ? (item.endDate as any).toMillis() : (item.endDate as any) ?? null;
    return (
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: '#EEF2FF', marginBottom: 12 }}>
        <Text style={{ fontWeight: '600' }}>{(item.title || 'Trip Plan') + (item?.id ? ` (v${(item as any).version ?? 1})` : '')}</Text>
        {startTs || endTs ? (
          <Text style={{ color: '#6B7280', marginTop: 4 }}>
            {startTs ? new Date(startTs).toLocaleDateString() : '—'} → {endTs ? new Date(endTs).toLocaleDateString() : '—'}
          </Text>
        ) : null}
        {item.notes ? <Text style={{ color: '#374151', marginTop: 4 }} numberOfLines={3}>{item.notes}</Text> : null}
        <Text style={{ color: '#6B7280', marginTop: 6 }}>Members: {names || (item.members || []).length}</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
          <TouchableOpacity onPress={() => nav.navigate('TripPlanner', { chatId: item.chatId })}>
            <Text style={{ color: '#2563EB' }}>Open planner</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => {
            setEditTrip(item);
            setEditTitle(item.title || '');
            setEditNotes(item.notes || '');
            const sTs = startTs ? new Date(startTs) : null;
            const eTs = endTs ? new Date(endTs) : null;
            setEditStart(sTs ? `${String(sTs.getMonth() + 1).padStart(2,'0')}/${String(sTs.getDate()).padStart(2,'0')}/${sTs.getFullYear()}` : '');
            setEditEnd(eTs ? `${String(eTs.getMonth() + 1).padStart(2,'0')}/${String(eTs.getDate()).padStart(2,'0')}/${eTs.getFullYear()}` : '');
          }}>
            <Text style={{ color: '#2563EB' }}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={async () => {
            try {
              await updateDoc(doc(db, 'trips', item.id), { archived: true, updatedAt: Date.now(), updatedBy: auth.currentUser?.uid || 'system' } as any);
            } catch {}
          }}>
            <Text style={{ color: '#6B7280' }}>Archive</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => {
            Alert.alert(
              'Delete trip?',
              'This will remove the trip for everyone in the chat. This action cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteDoc(doc(db, 'trips', item.id)); } catch {} } },
              ]
            );
          }}>
            <Text style={{ color: '#EF4444' }}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 12 }}>Trips</Text>
      {trips.filter((t) => !(t as any)?.archived).length === 0 ? (
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

      <Modal visible={!!editTrip} animationType="slide" transparent onRequestClose={() => setEditTrip(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16 }}>
            <Text style={{ fontWeight: '600', fontSize: 16, marginBottom: 8 }}>Edit trip</Text>
            <Text style={{ marginBottom: 4 }}>Title</Text>
            <TextInput value={editTitle} onChangeText={setEditTitle} placeholder="Trip title" style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 8 }} />
            <Text style={{ marginBottom: 4 }}>Notes</Text>
            <TextInput value={editNotes} onChangeText={setEditNotes} placeholder="Notes" multiline style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 8, minHeight: 80 }} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ marginBottom: 4 }}>Start (MM/DD/YYYY)</Text>
                <TextInput value={editStart} onChangeText={setEditStart} placeholder="MM/DD/YYYY" style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10 }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ marginBottom: 4 }}>End (MM/DD/YYYY)</Text>
                <TextInput value={editEnd} onChangeText={setEditEnd} placeholder="MM/DD/YYYY" style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10 }} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
              <TouchableOpacity onPress={() => setEditTrip(null)}>
                <Text style={{ color: '#666' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={async () => {
                if (!editTrip) return;
                const parseMDY = (val: string) => {
                  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(val || '');
                  if (!m) return null;
                  const mm = Math.max(1, Math.min(12, parseInt(m[1], 10)));
                  const dd = Math.max(1, Math.min(31, parseInt(m[2], 10)));
                  const yy = parseInt(m[3], 10);
                  const dt = new Date(yy, mm - 1, dd);
                  if (isNaN(dt.getTime())) return null;
                  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
                };
                const s = parseMDY(editStart);
                const e = parseMDY(editEnd);
                try {
                  const nextVersion = ((editTrip as any).version ?? 0) + 1;
                  await updateDoc(doc(db, 'trips', editTrip.id), {
                    title: editTitle.trim() || null,
                    notes: editNotes.trim() || null,
                    startDate: s,
                    endDate: e,
                    version: nextVersion,
                    updatedAt: Date.now(),
                    updatedBy: auth.currentUser?.uid || 'system',
                  } as any);
                  setEditTrip(null);
                } catch {}
              }}>
                <Text style={{ color: '#2563EB' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}


