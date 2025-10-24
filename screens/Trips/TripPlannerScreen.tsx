import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { TripsStackParamList } from '../../navigation/TripsStack';
import { db } from '../../firebase/config';
import { doc, onSnapshot } from 'firebase/firestore';

export default function TripPlannerScreen() {
  const route = useRoute<RouteProp<TripsStackParamList, 'TripPlanner'>>();
  const { chatId } = route.params || ({} as any);
  const [trip, setTrip] = useState<any>(null);

  useEffect(() => {
    if (!chatId) return;
    const ref = doc(db, 'trips', chatId);
    const unsub = onSnapshot(ref, (snap) => setTrip({ id: snap.id, ...(snap.data() as any) }));
    return () => unsub();
  }, [chatId]);

  const dateRange = useMemo(() => {
    const s = typeof (trip?.startDate as any)?.toMillis === 'function' ? (trip?.startDate as any).toMillis() : (trip?.startDate as any) ?? null;
    const e = typeof (trip?.endDate as any)?.toMillis === 'function' ? (trip?.endDate as any).toMillis() : (trip?.endDate as any) ?? null;
    return s || e ? `${s ? new Date(s).toLocaleDateString() : '—'} → ${e ? new Date(e).toLocaleDateString() : '—'}` : null;
  }, [trip]);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '600' }}>{trip?.title || 'Trip Planner'}</Text>
      {dateRange ? <Text style={{ color: '#6B7280', marginTop: 4 }}>{dateRange}</Text> : null}
      {trip?.notes ? <Text style={{ marginTop: 8 }}>{trip.notes}</Text> : null}
      <Text style={{ fontSize: 16, fontWeight: '600', marginTop: 16 }}>Itinerary</Text>
      <FlatList
        data={Array.isArray(trip?.itinerary) ? trip.itinerary : []}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }: any) => (
          <View style={{ padding: 12, borderRadius: 10, backgroundColor: '#F3F4F6', marginTop: 8 }}>
            <Text style={{ fontWeight: '600' }}>{item?.date || 'Day'}</Text>
            {item?.items?.map?.((it: any, idx: number) => (
              <Text key={idx} style={{ color: '#374151' }}>• {it}</Text>
            ))}
          </View>
        )}
        ListEmptyComponent={<Text style={{ color: '#6B7280', marginTop: 8 }}>No itinerary yet.</Text>}
      />
    </View>
  );
}


