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

type ItineraryDay = {
  date: string;
  city?: string;
  resolved?: { name: string; lat: number; lon: number };
  items: string[];
};

export default function TripPlannerScreen() {
  const c = useThemeColors();
  const route = useRoute<RouteProp<TripsStackParamList, 'TripPlanner'>>();
  const { chatId } = route.params || ({} as any);
  const [trip, setTrip] = useState<any>(null);
  const [itinerary, setItinerary] = useState<Array<ItineraryDay>>([]);
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
        // Accept existing docs with or without city/resolved fields
        const arr = (data as any).itinerary as any[];
        const titleCity = String((data as any)?.title || '').includes(' - ')
          ? String((data as any)?.title || '').split(' - ')[0].trim()
          : '';
        let carry = titleCity || '';
        const norm: ItineraryDay[] = arr.map((d) => {
          const nd: ItineraryDay = {
            date: String(d?.date || ''),
            city: d?.city || undefined,
            resolved: d?.resolved ? { name: String(d.resolved.name || ''), lat: Number(d.resolved.lat || 0), lon: Number(d.resolved.lon || 0) } : undefined,
            items: Array.isArray(d?.items) ? d.items.map((x: any) => String(x)) : [],
          };
          if (!nd.city && !nd.resolved?.name && carry) nd.city = carry;
          carry = nd.city || nd.resolved?.name || carry;
          return nd;
        });
        setItinerary(norm);
      } else {
        // initialize from date range if available
        const s = typeof (data?.startDate as any)?.toMillis === 'function' ? (data?.startDate as any).toMillis() : (data?.startDate as any) ?? null;
        const e = typeof (data?.endDate as any)?.toMillis === 'function' ? (data?.endDate as any).toMillis() : (data?.endDate as any) ?? null;
        if (s && e && e >= s) {
          const days: Array<ItineraryDay> = [];
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

      // City precedence: day.city → carry-forward → title city (weatherCity)
      const defaultCity = weatherCity || '';
      const cityForDate: Record<string, string> = {};
      let carryCity = defaultCity;
      dates.forEach((dt) => {
        const day = (itinerary || []).find((d) => d.date === dt);
        const chosen = (day?.city || '').trim() || carryCity || defaultCity;
        cityForDate[dt] = chosen;
        carryCity = chosen;
      });
      if (__DEV__) {
        console.log('[TripPlannerWeather] dates', dates);
        console.log('[TripPlannerWeather] cityForDate', cityForDate);
      }

      // Group consecutive dates by city to minimize API calls
      type Segment = { city: string; originalDates: string[] };
      const segments: Segment[] = [];
      let currentSegment: Segment | null = null;
      dates.forEach((dt) => {
        const c = cityForDate[dt];
        if (!currentSegment || currentSegment.city !== c) {
          if (currentSegment) segments.push(currentSegment);
          currentSegment = { city: c, originalDates: [dt] };
        } else {
          currentSegment.originalDates.push(dt);
        }
      });
      if (currentSegment) segments.push(currentSegment);
      if (__DEV__) {
        console.log('[TripPlannerWeather] segments', segments);
      }

      // Normalize year to avoid historical requests
      const today = new Date();
      today.setHours(0,0,0,0);
      const thisYear = today.getFullYear();
      const normalizeDate = (iso: string): string => {
        const mm = Number(iso.slice(5,7));
        const dd = Number(iso.slice(8,10));
        let d = new Date(thisYear, (mm - 1), dd);
        d.setHours(0,0,0,0);
        if (d.getTime() < today.getTime()) {
          d = new Date(thisYear + 1, (mm - 1), dd);
          d.setHours(0,0,0,0);
        }
        return d.toISOString().slice(0,10);
      };

      const map: Record<string, { lo: number; hi: number; cond: string; icon?: string; city?: string }> = {};
      const resolverCache: Record<string, { name: string; lat: number; lon: number }> = {};
      for (const seg of segments) {
        if (!seg.city) continue;
        const originals = seg.originalDates;
        const normStart = normalizeDate(originals[0]);
        const normEnd = normalizeDate(originals[originals.length - 1]);
        // Build normalized date list to align with originals
        const normDates: string[] = [];
        for (let t = Date.parse(normStart); t <= Date.parse(normEnd); t += 24*3600*1000) {
          normDates.push(new Date(t).toISOString().slice(0,10));
        }
        const res = await fetchTripWeather(chatId, seg.city, normStart, normEnd);
        if (__DEV__) {
          console.log('[TripPlannerWeather] fetch', { city: seg.city, normStart, normEnd, originals: seg.originalDates });
        }
        const resolvedCity = String((res as any)?.city || seg.city || '');
        if (res?.resolved?.name) {
          resolverCache[seg.city] = { name: res.resolved.name, lat: res.resolved.lat, lon: res.resolved.lon };
        }
        const byDate: Record<string, any> = {};
        (res.days || []).forEach((d: any) => { byDate[String(d.date)] = d; });
        const n = Math.min(originals.length, normDates.length);
        for (let i = 0; i < n; i++) {
          const od = originals[i];
          const nd = normDates[i];
          const day = byDate[nd];
          if (day) {
            map[od] = { lo: day.lo, hi: day.hi, cond: day.cond, icon: day.icon, city: resolvedCity };
          }
        }
      }
      setWeather(map);

      // Write back resolved to days
      const next = itinerary.map((day) => {
        const c = day.city || '';
        const resolved = c && resolverCache[c] ? resolverCache[c] : day.resolved;
        return { ...day, resolved };
      });
      setItinerary(next);
      saveItineraryQuick(next);
      if (__DEV__) {
        console.log('[TripPlannerWeather] resolverCache', resolverCache);
      }
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
    setItinerary((arr) => {
      const prevCity = arr.length > 0 ? (arr[arr.length - 1].city || arr[arr.length - 1].resolved?.name || weatherCity || '') : (weatherCity || '');
      return [...arr, { date: nextDateStr, city: prevCity || undefined, items: [] }];
    });
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
      const clean = sanitizeItineraryForFirestore(itinerary);
      await updateDoc(doc(db, 'trips', chatId), {
        itinerary: clean,
        version: nextVersion,
        updatedAt: Date.now(),
      } as any);
      Alert.alert('Saved', 'Itinerary updated');
    } catch (e: any) {
      Alert.alert('Save failed', String(e?.message || e));
    }
  };

  const saveItineraryQuick = async (next: ItineraryDay[]) => {
    if (!chatId) return;
    try {
      const clean = sanitizeItineraryForFirestore(next);
      await updateDoc(doc(db, 'trips', chatId), {
        itinerary: clean,
        updatedAt: Date.now(),
      } as any);
    } catch {}
  };

  function sanitizeItineraryForFirestore(arr: ItineraryDay[]) {
    return (arr || []).map((d) => {
      const base: any = { date: String(d?.date || ''), items: Array.isArray(d?.items) ? d.items : [] };
      if (d?.city && d.city.trim()) base.city = d.city.trim();
      if (d?.resolved && typeof d.resolved.lat === 'number' && typeof d.resolved.lon === 'number' && d.resolved.name) {
        base.resolved = { name: String(d.resolved.name), lat: Number(d.resolved.lat), lon: Number(d.resolved.lon) };
      }
      return base;
    });
  }

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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <Text style={{ color: c.textSubtle, width: 40 }}>City</Text>
                <TextInput
                  value={item.city || ''}
                  onChangeText={(txt) => {
                    setItinerary((arr) => arr.map((d, i) => (i === index ? { ...d, city: txt || undefined, resolved: undefined } : d)));
                  }}
                  onEndEditing={() => {
                    const next = itinerary.map((d, i) => (i === index ? { ...d, city: (d.city || '') || undefined, resolved: undefined } : d));
                    saveItineraryQuick(next);
                  }}
                  placeholder="City (optional)"
                  placeholderTextColor={c.textMuted}
                  style={{ flex: 1, borderWidth: 1, borderColor: c.line, color: c.text, backgroundColor: c.surface, borderRadius: 8, padding: 8 }}
                />
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


