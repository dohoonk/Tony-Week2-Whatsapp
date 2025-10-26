import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, Image } from 'react-native';
import AppCard from '../../components/AppCard';
import AppText from '../../components/AppText';
import AppButton from '../../components/AppButton';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useThemeColors } from '../../lib/theme';
import { TripsStackParamList } from '../../navigation/TripsStack';
import { db } from '../../firebase/config';
import { doc, onSnapshot, updateDoc, getDoc, addDoc, collection } from 'firebase/firestore';
import { fetchItinerary, fetchTripWeather } from '../../lib/ai';

export default function TripPlannerScreen() {
  const c = useThemeColors();
  const route = useRoute<RouteProp<TripsStackParamList, 'TripPlanner'>>();
  const { chatId } = route.params || ({} as any);
  const [trip, setTrip] = useState<any>(null);
  const [itinerary, setItinerary] = useState<Array<{ date: string; items: string[] }>>([]);
  const [userCache, setUserCache] = useState<Record<string, any>>({});
  const [weather, setWeather] = useState<Record<string, { lo: number; hi: number; cond: string; icon?: string; city?: string }>>({});
  const [weatherCity, setWeatherCity] = useState<string>('');
  const [weatherWarn, setWeatherWarn] = useState<string>('');

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
      // Infer city from title (format: "Destination - start - end")
      const t = String((data as any)?.title || '');
      const inferredCity = t.includes(' - ') ? t.split(' - ')[0].trim() : '';
      setWeatherCity(inferredCity);
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

  const computeStartEndIso = (): { start?: string; end?: string } => {
    const sMs = typeof (trip?.startDate as any)?.toMillis === 'function' ? (trip?.startDate as any).toMillis() : (trip?.startDate as any) ?? null;
    const eMs = typeof (trip?.endDate as any)?.toMillis === 'function' ? (trip?.endDate as any).toMillis() : (trip?.endDate as any) ?? null;
    if (sMs && eMs) return { start: new Date(sMs).toISOString().slice(0, 10), end: new Date(eMs).toISOString().slice(0, 10) };
    if (Array.isArray(itinerary) && itinerary.length > 0) {
      const start = itinerary[0]?.date;
      const end = itinerary[itinerary.length - 1]?.date;
      if (start && end) return { start, end };
    }
    return {};
  };

  const loadWeather = async () => {
    try {
      setWeatherWarn('');
      const { start, end } = computeStartEndIso();
      if (!chatId || !start || !end) {
        setWeatherWarn('Missing dates');
        return;
      }

      // Build date list from itinerary or range
      const dates: string[] = [];
      if (Array.isArray(itinerary) && itinerary.length > 0) {
        itinerary.forEach((d) => { if (d?.date) dates.push(d.date); });
      } else {
        // fallback to start..end
        for (let t = Date.parse(start); t <= Date.parse(end); t += 24*3600*1000) {
          dates.push(new Date(t).toISOString().slice(0,10));
        }
      }
      if (dates.length === 0) {
        setWeatherWarn('No dates found for weather');
        return;
      }

      // Infer default city from title
      const defaultCity = weatherCity;
      // Heuristic: parse city from day items; carry forward last known city
      const cityForDate: Record<string, string> = {};
      let currentCity = defaultCity || '';
      const cityRe = /(arrive|in|at|to)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/i;
      dates.forEach((dt) => {
        const day = (itinerary || []).find((d) => d.date === dt);
        let found = '';
        if (day) {
          for (const raw of (day.items || [])) {
            const m = cityRe.exec(String(raw || ''));
            if (m && m[2]) { found = m[2].trim(); break; }
          }
        }
        if (found) currentCity = found;
        cityForDate[dt] = currentCity || (defaultCity || '');
      });

      // Group consecutive dates by city to minimize API calls
      type Segment = { city: string; start: string; end: string };
      const segments: Segment[] = [];
      let segCity = '';
      let segStart = '';
      dates.forEach((dt, idx) => {
        const c = cityForDate[dt];
        if (!segStart) { segStart = dt; segCity = c; }
        const nextDate = dates[idx + 1];
        const nextCity = nextDate ? cityForDate[nextDate] : undefined;
        if (!nextDate || nextCity !== c) {
          segments.push({ city: c, start: segStart, end: dt });
          segStart = ''; segCity = '';
        }
      });

      const map: Record<string, { lo: number; hi: number; cond: string; icon?: string; city?: string }> = {};
      for (const seg of segments) {
        if (!seg.city) continue;
        const res = await fetchTripWeather(chatId, seg.city, seg.start, seg.end);
        const resolvedCity = String((res as any)?.city || seg.city || '');
        (res.days || []).forEach((d: any) => { map[d.date] = { lo: d.lo, hi: d.hi, cond: d.cond, icon: d.icon, city: resolvedCity }; });
      }
      setWeather(map);
    } catch (e: any) {
      setWeatherWarn(String(e?.message || e));
    }
  };

  // Auto-load weather once when we have city and dates
  useEffect(() => {
    const { start, end } = computeStartEndIso();
    if (weatherCity && start && end && Object.keys(weather).length === 0) {
      loadWeather();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherCity, trip, itinerary]);

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

  const generateItinerary = async () => {
    if (!chatId) return;
    try {
      const gen = await fetchItinerary(chatId);
      if (Array.isArray(gen) && gen.length > 0) {
        // Clamp to current range if available
        const { start, end } = computeStartEndIso();
        const filtered = (start && end) ? gen.filter((d) => d.date >= start && d.date <= end) : gen;
        setItinerary(filtered.map((d) => ({ date: d.date, items: Array.from(new Set(d.items || [])) })));
      }
    } catch (e: any) {
      Alert.alert('Generate failed', String(e?.message || e));
    }
  };

  const postToChat = async () => {
    try {
      if (!trip?.chatId) return;
      const title = String(trip?.title || 'Trip');
      const { start, end } = computeStartEndIso();
      const header = `${title}${start || end ? ` (${start || '—'} → ${end || '—'})` : ''}`;
      const lines: string[] = [];
      itinerary.forEach((d) => {
        lines.push(`${d.date}`);
        (d.items || []).forEach((it) => lines.push(`- ${it}`));
      });
      const body = lines.length > 0 ? lines.join('\n') : 'No items yet.';
      const text = `${header}\n${body}`;
      await addDoc(collection(db, 'chats', trip.chatId, 'messages'), {
        senderId: 'ai',
        text,
        imageUrl: null,
        timestamp: Date.now(),
        type: 'ai_response',
        visibility: 'shared',
        relatedFeature: 'trip',
        relatedId: trip.chatId,
        createdBy: 'system',
      } as any);
      await updateDoc(doc(db, 'chats', trip.chatId), { lastMessage: `Trip shared: ${title}`, lastMessageAt: Date.now() } as any);
      Alert.alert('Shared', 'Trip posted to the chat');
    } catch (e: any) {
      Alert.alert('Share failed', String(e?.message || e));
    }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <AppText variant="title">{trip?.title || 'Trip Planner'}</AppText>
      {dateRange ? <AppText variant="meta" style={{ color: c.textSubtle, marginTop: 4 }}>{dateRange}</AppText> : null}
      {Array.isArray(trip?.members) && trip.members.length > 0 ? (
        <Text style={{ color: c.textSubtle, marginTop: 4 }}>Members: {memberNames}</Text>
      ) : null}
      {trip?.notes ? <Text style={{ marginTop: 8, color: c.text }}>{trip.notes}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 16 }}>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <AppButton title="Generate" onPress={generateItinerary} variant="primary" size="sm" />
          <AppButton title="Refresh weather" onPress={loadWeather} variant="outline" size="sm" />
          <AppButton title="Add day" onPress={addDay} variant="secondary" size="sm" />
          <AppButton title="Save" onPress={saveItinerary} variant="primary" size="sm" />
          <AppButton title="Post to chat" onPress={postToChat} variant="outline" size="sm" />
        </View>
      </View>
      <View style={{ marginTop: 8 }}>
        <AppText variant="title" style={{ fontSize: 16 }}>Itinerary</AppText>
      </View>
      {weatherWarn ? <Text style={{ color: c.error, marginTop: 4 }}>{weatherWarn}</Text> : null}

      {itinerary.length === 0 ? (
        <Text style={{ color: '#6B7280', marginTop: 8 }}>No itinerary yet.</Text>
      ) : (
        <FlatList
          data={itinerary}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item, index }) => (
            <AppCard style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText>{item?.date || `Day ${index + 1}`}</AppText>
                <TouchableOpacity onPress={() => removeDay(index)}><Text style={{ color: '#EF4444' }}>Remove day</Text></TouchableOpacity>
              </View>
              {weather[item?.date] ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  {weather[item.date].icon ? (
                    <Image source={{ uri: weather[item.date].icon }} style={{ width: 20, height: 20 }} />
                  ) : null}
                  <AppText variant="meta" style={{ color: c.textSubtle }}>
                    {weather[item.date].city ? `${weather[item.date].city}: ` : ''}
                    {weather[item.date].lo}°F–{weather[item.date].hi}°F, {weather[item.date].cond}
                  </AppText>
                </View>
              ) : null}
              {(item?.items || []).map((it, idx) => (
                <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <AppText style={{ color: c.text, flexShrink: 1 }}>• {it}</AppText>
                  <TouchableOpacity onPress={() => removeItem(index, idx)}><Text style={{ color: c.error }}>Remove</Text></TouchableOpacity>
                </View>
              ))}
              <AddItemRow onAdd={(txt) => addItem(index, txt)} />
            </AppCard>
          )}
        />
      )}
    </View>
  );
}

function AddItemRow({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  const c = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Add item"
        style={{ flex: 1, borderWidth: 1, borderColor: c.line, color: c.text, backgroundColor: c.surface, borderRadius: 8, padding: 8 }}
      />
      <TouchableOpacity onPress={() => { if (text.trim()) { onAdd(text.trim()); setText(''); } }}>
        <Text style={{ color: c.primary }}>Add</Text>
      </TouchableOpacity>
    </View>
  );
}


