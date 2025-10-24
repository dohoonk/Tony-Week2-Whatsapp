import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { TripsStackParamList } from '../../navigation/TripsStack';
import { db } from '../../firebase/config';
import { doc, onSnapshot, updateDoc, getDoc } from 'firebase/firestore';

export default function TripPlannerScreen() {
  const route = useRoute<RouteProp<TripsStackParamList, 'TripPlanner'>>();
  const { chatId } = route.params || ({} as any);
  const [trip, setTrip] = useState<any>(null);
  const [itinerary, setItinerary] = useState<Array<{ date: string; items: string[] }>>([]);
  const [userCache, setUserCache] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!chatId) return;
    const ref = doc(db, 'trips', chatId);
    const unsub = onSnapshot(ref, (snap) => {
      const data = { id: snap.id, ...(snap.data() as any) };
      setTrip(data);
      if (Array.isArray((data as any)?.itinerary)) {
        setItinerary((data as any).itinerary as any);
      } else {
        // initialize from date range if available
        const s = typeof (data?.startDate as any)?.toMillis === 'function' ? (data?.startDate as any).toMillis() : (data?.startDate as any) ?? null;
        const e = typeof (data?.endDate as any)?.toMillis === 'function' ? (data?.endDate as any).toMillis() : (data?.endDate as any) ?? null;
        if (s && e && e >= s) {
          const days: Array<{ date: string; items: string[] }> = [];
          for (let t = s; t <= e; t += 24 * 3600 * 1000) {
            const d = new Date(t).toISOString().slice(0, 10);
            days.push({ date: d, items: [] });
          }
          setItinerary(days);
        } else {
          setItinerary([]);
        }
      }
    });
    return () => unsub();
  }, [chatId]);

  const ensureUser = async (uid: string) => {
    if (userCache[uid]) return userCache[uid];
    const uref = doc(db, 'users', uid);
    const snap = await getDoc(uref);
    const data = snap.exists() ? snap.data() : null;
    setUserCache((m) => ({ ...m, [uid]: data }));
    return data;
  };

  const dateRange = useMemo(() => {
    const s = typeof (trip?.startDate as any)?.toMillis === 'function' ? (trip?.startDate as any).toMillis() : (trip?.startDate as any) ?? null;
    const e = typeof (trip?.endDate as any)?.toMillis === 'function' ? (trip?.endDate as any).toMillis() : (trip?.endDate as any) ?? null;
    return s || e ? `${s ? new Date(s).toLocaleDateString() : '—'} → ${e ? new Date(e).toLocaleDateString() : '—'}` : null;
  }, [trip]);

  const memberNames = useMemo(() => {
    const ids: string[] = Array.isArray(trip?.members) ? trip.members : [];
    ids.forEach((id) => { if (!userCache[id]) ensureUser(id); });
    return ids.map((id) => userCache[id]?.displayName || id).join(', ');
  }, [trip, userCache]);

  const addDay = () => {
    // propose next date after last, or today
    let nextDateStr = new Date().toISOString().slice(0, 10);
    if (itinerary.length > 0) {
      const lastDate = itinerary[itinerary.length - 1].date;
      const t = Date.parse(lastDate) + 24 * 3600 * 1000;
      nextDateStr = new Date(t).toISOString().slice(0, 10);
    }
    setItinerary((arr) => [...arr, { date: nextDateStr, items: [] }]);
  };

  const addItem = (idx: number, text: string) => {
    if (!text.trim()) return;
    setItinerary((arr) => arr.map((d, i) => (i === idx ? { ...d, items: [...(d.items || []), text.trim()] } : d)));
  };

  const removeItem = (dayIdx: number, itemIdx: number) => {
    setItinerary((arr) => arr.map((d, i) => (i === dayIdx ? { ...d, items: (d.items || []).filter((_, j) => j !== itemIdx) } : d)));
  };

  const removeDay = (idx: number) => {
    setItinerary((arr) => arr.filter((_, i) => i !== idx));
  };

  const saveItinerary = async () => {
    if (!chatId) return;
    try {
      const nextVersion = ((trip?.version as number) ?? 0) + 1;
      await updateDoc(doc(db, 'trips', chatId), {
        itinerary,
        version: nextVersion,
        updatedAt: Date.now(),
      } as any);
      Alert.alert('Saved', 'Itinerary updated');
    } catch (e: any) {
      Alert.alert('Save failed', String(e?.message || e));
    }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '600' }}>{trip?.title || 'Trip Planner'}</Text>
      {dateRange ? <Text style={{ color: '#6B7280', marginTop: 4 }}>{dateRange}</Text> : null}
      {Array.isArray(trip?.members) && trip.members.length > 0 ? (
        <Text style={{ color: '#6B7280', marginTop: 4 }}>Members: {memberNames}</Text>
      ) : null}
      {trip?.notes ? <Text style={{ marginTop: 8 }}>{trip.notes}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>Itinerary</Text>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <TouchableOpacity onPress={addDay}><Text style={{ color: '#2563EB' }}>Add day</Text></TouchableOpacity>
          <TouchableOpacity onPress={saveItinerary}><Text style={{ color: '#2563EB' }}>Save</Text></TouchableOpacity>
        </View>
      </View>

      {itinerary.length === 0 ? (
        <Text style={{ color: '#6B7280', marginTop: 8 }}>No itinerary yet.</Text>
      ) : (
        <FlatList
          data={itinerary}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item, index }) => (
            <View style={{ padding: 12, borderRadius: 10, backgroundColor: '#F3F4F6', marginTop: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '600' }}>{item?.date || `Day ${index + 1}`}</Text>
                <TouchableOpacity onPress={() => removeDay(index)}><Text style={{ color: '#EF4444' }}>Remove day</Text></TouchableOpacity>
              </View>
              {(item?.items || []).map((it, idx) => (
                <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <Text style={{ color: '#374151', flexShrink: 1 }}>• {it}</Text>
                  <TouchableOpacity onPress={() => removeItem(index, idx)}><Text style={{ color: '#EF4444' }}>Remove</Text></TouchableOpacity>
                </View>
              ))}
              <AddItemRow onAdd={(txt) => addItem(index, txt)} />
            </View>
          )}
        />
      )}
    </View>
  );
}

function AddItemRow({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Add item"
        style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8 }}
      />
      <TouchableOpacity onPress={() => { if (text.trim()) { onAdd(text.trim()); setText(''); } }}>
        <Text style={{ color: '#2563EB' }}>Add</Text>
      </TouchableOpacity>
    </View>
  );
}


