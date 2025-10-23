import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, Button, Image, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, Dimensions, AppState } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { ChatsStackParamList } from '../../navigation/ChatsStack';
import { collection, onSnapshot, orderBy, query, doc, getDoc, limit, startAfter, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { auth } from '../../firebase/config';
import { sendMessage, updateReadStatus } from '../../firebase/chatService';
import * as ImagePicker from 'expo-image-picker';
import { uploadChatImage } from '../../firebase/storageService';
import { showLocalNotification } from '../../lib/notifications';

type Message = {
  id: string;
  senderId: string;
  text?: string | null;
  imageUrl?: string | null;
  timestamp: number;
  temp?: boolean;
};

export default function ChatRoomScreen() {
  const BUBBLE_MAX = Math.round(Dimensions.get('window').width * 0.7);
  const route = useRoute<RouteProp<ChatsStackParamList, 'ChatRoom'>>();
  const navigation = useNavigation();
  const { chatId } = route.params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [lastReadAt, setLastReadAt] = useState<number | null>(null);
  const [isSomeoneTyping, setIsSomeoneTyping] = useState(false);
  const typingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const prevCountRef = React.useRef<number>(0);
  const listRef = React.useRef<FlatList<any>>(null);
  const hasLoadedRef = React.useRef<boolean>(false);
  const atBottomRef = React.useRef<boolean>(true);
  const [readMap, setReadMap] = useState<Record<string, any>>({});
  const [members, setMembers] = useState<string[]>([]);
  const [profileCache, setProfileCache] = useState<Record<string, any>>({});
  const scrolledToUnreadRef = React.useRef<boolean>(false);
  const initialLastReadAtRef = React.useRef<number | null>(null);
  const persistDividerRef = React.useRef<boolean>(false);
  const didInitialScrollRef = React.useRef<boolean>(false);
  const initialReadEntryRef = React.useRef<{ id: string | null; at: number | null } | null>(null);
  const [oldestCursor, setOldestCursor] = useState<any>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean>(true);
  const [loadingOlder, setLoadingOlder] = useState<boolean>(false);
  const lastMarkedRef = React.useRef<number>(0);
  const outboxRef = React.useRef<Record<string, { kind: 'text' | 'image'; text?: string; uri?: string }>>({});
  const retryTimerRef = React.useRef<any>(null);

  // Debug: compute last-read message id for current user (from readMap or lastReadAt)
  const lastReadMessageId = React.useMemo(() => {
    const uid = auth.currentUser?.uid as string | undefined;
    const entry = uid ? (readMap as any)[uid] : undefined;
    let boundaryId: string | null = null;
    let boundaryAt: number | null = null;
    if (entry && typeof entry === 'object') {
      boundaryId = entry.id ?? null;
      boundaryAt = typeof entry.at === 'number' ? entry.at : null;
    } else if (typeof entry === 'number') {
      boundaryAt = entry as number;
    } else if (typeof lastReadAt === 'number') {
      boundaryAt = lastReadAt as number;
    }
    if (boundaryId) return boundaryId;
    if (boundaryAt && messages.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if ((m?.timestamp ?? 0) <= boundaryAt) return m.id;
      }
    }
    return null;
  }, [messages, readMap, lastReadAt]);

  const ensureProfile = async (uid: string) => {
    if (profileCache[uid]) return profileCache[uid];
    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.exists() ? snap.data() : null;
    setProfileCache((c) => ({ ...c, [uid]: data }));
    return data;
  };

  useEffect(() => {
    // Set title from chat doc (groupName) if available
    const chatRef = doc(db, 'chats', chatId);
    const unsubTitle = onSnapshot(chatRef, (snap) => {
      const data: any = snap.data() || {};
      if (data?.type === 'group' && data?.groupName) {
        // @ts-ignore
        navigation.setOptions?.({ title: data.groupName });
        // @ts-ignore
        navigation.setOptions?.({
          headerRight: () => (
            // @ts-ignore
            <Text onPress={() => navigation.navigate('GroupSettings' as never, { chatId } as never)} style={{ color: '#0066cc', marginRight: 12 }}>Edit</Text>
          ),
        });
      }
      setReadMap(data?.readStatus || {});
      setMembers(Array.isArray(data?.members) ? data.members : []);
    });
    // Prime initial lastReadAt before messages subscription so divider renders on first paint
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'chats', chatId));
        const data: any = snap.data() || {};
        const uid = auth.currentUser?.uid;
        if (uid && initialLastReadAtRef.current === null) {
          const rs = data?.readStatus || {};
          initialLastReadAtRef.current = rs[uid] ?? null;
          persistDividerRef.current = true;
        }
      } catch {}
    })();
    // Live subscribe to the latest 10 messages
    const ref = collection(db, 'chats', chatId, 'messages');
    const q = query(ref, orderBy('timestamp', 'desc'), limit(10));
    const unsub = onSnapshot(q, (snap) => {
      const liveDesc = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any), __doc: d }));
      if (liveDesc.length > 0) setOldestCursor(liveDesc[liveDesc.length - 1].__doc);
      const liveAsc = liveDesc
        .slice()
        .reverse()
        .map(({ __doc, ...m }) => m as any);
      // Merge with existing (older) messages and de-dup, then sort asc
      setMessages((prev) => {
        const map = new Map<string, any>();
        [...prev, ...liveAsc].forEach((m: any) => map.set(m.id, m));
        return Array.from(map.values()).sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
      });
      const uid = auth.currentUser?.uid;
      // Only mark read when we've loaded once and are at (or near) the bottom
      if (uid && hasLoadedRef.current && atBottomRef.current) {
        const now = Date.now();
        if (now - lastMarkedRef.current > 500) {
          updateReadStatus(chatId, uid);
          lastMarkedRef.current = now;
        }
      }
      // Foreground local notification for new incoming message
      const prev = prevCountRef.current;
      if (liveAsc.length > prev) {
        const last = liveAsc[liveAsc.length - 1];
        const myUid = auth.currentUser?.uid;
        if (last && last.senderId !== myUid) {
          const body = last.text ? String(last.text) : 'Sent a photo';
          showLocalNotification('New message', body);
        } else if (last && last.senderId === myUid) {
          // If I just sent a message, scroll to bottom to reveal it
          requestAnimationFrame(() => {
            listRef.current?.scrollToEnd?.({ animated: true });
          });
        }
      }
      prevCountRef.current = liveAsc.length;
      if (!hasLoadedRef.current) hasLoadedRef.current = true;
    });
    return () => { unsub(); unsubTitle(); };
  }, [chatId]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      outboxRef.current = {};
    };
  }, []);

  const startRetryLoop = () => {
    if (retryTimerRef.current) return;
    retryTimerRef.current = setInterval(async () => {
      const entries = Object.entries(outboxRef.current);
      if (entries.length === 0) return;
      const [tempId, job] = entries[0];
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        if (job.kind === 'text' && job.text) {
          await sendMessage(chatId, uid, { text: job.text });
        } else if (job.kind === 'image' && job.uri) {
          const imageUrl = await uploadChatImage(chatId, job.uri);
          await sendMessage(chatId, uid, { imageUrl });
        }
        // success: remove temp and job
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        delete outboxRef.current[tempId];
        // if queue empty, stop timer
        if (Object.keys(outboxRef.current).length === 0 && retryTimerRef.current) {
          clearInterval(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      } catch (e) {
        // keep job; will retry next tick
      }
    }, 1000);
  };

  const flushOutboxNow = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const entries = Object.entries(outboxRef.current);
    for (const [tempId, job] of entries) {
      try {
        if (job.kind === 'text' && job.text) {
          await sendMessage(chatId, uid, { text: job.text });
        } else if (job.kind === 'image' && job.uri) {
          const imageUrl = await uploadChatImage(chatId, job.uri);
          await sendMessage(chatId, uid, { imageUrl });
        }
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        delete outboxRef.current[tempId];
      } catch (e) {
        // stop immediate loop on first failure; timer will retry
        break;
      }
    }
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        flushOutboxNow();
        startRetryLoop();
      }
    });
    return () => sub.remove();
  }, []);

  // Compute the index of the first unread message (in raw messages),
  // anchored to the entry-time read boundary so the divider persists until unmount
  const firstUnreadIndex = React.useMemo(() => {
    const boundary = (initialLastReadAtRef.current ?? lastReadAt) as number | null;
    if (!boundary || messages.length === 0) return null;
    const idx = messages.findIndex((m) => (m?.timestamp ?? 0) > boundary);
    return idx >= 0 ? idx : null;
  }, [messages]);

  // Jump to the unread divider on first load
  useEffect(() => {
    if (firstUnreadIndex !== null && !scrolledToUnreadRef.current) {
      // Divider will be inserted at the same index; scroll near it
      requestAnimationFrame(() => {
        try {
          listRef.current?.scrollToIndex?.({ index: firstUnreadIndex, animated: false, viewPosition: 0.3 });
          scrolledToUnreadRef.current = true;
          atBottomRef.current = false;
        } catch {}
      });
    }
  }, [firstUnreadIndex]);

  // If there are no new messages, start scrolled to the latest message
  useEffect(() => {
    if (firstUnreadIndex === null && messages.length > 0 && !didInitialScrollRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd?.({ animated: false });
        atBottomRef.current = true;
        didInitialScrollRef.current = true;
      });
    }
  }, [messages, firstUnreadIndex]);

  // When chat unmounts, clear persistence flags so the divider doesn't persist between sessions
  useEffect(() => {
    return () => {
      scrolledToUnreadRef.current = false;
      initialLastReadAtRef.current = null;
      persistDividerRef.current = false;
      didInitialScrollRef.current = false;
    };
  }, []);

  // Listen to chat doc for my lastReadAt
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const chatRef = doc(db, 'chats', chatId);
    const unsub = onSnapshot(chatRef, (snap) => {
      const data: any = snap.data() || {};
      const rs = data.readStatus || {};
      const current = rs[uid] ?? null;
      setLastReadAt(current);
      if (initialLastReadAtRef.current === null) {
        initialLastReadAtRef.current = current;
        // Persist divider for the session; we will clear on unmount
        persistDividerRef.current = true;
      }
    });
    return () => unsub();
  }, [chatId]);

  // Typing indicator listeners
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    const typingRef = collection(db, 'chats', chatId, 'typing');
    const unsub = onSnapshot(typingRef, (snap) => {
      let someone = false;
      snap.forEach((d) => {
        const data: any = d.data();
        if (d.id !== uid && data?.typing) someone = true;
      });
      setIsSomeoneTyping(someone);
    });
    return () => unsub();
  }, [chatId]);

  const onSend = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !text.trim()) return;
    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      senderId: uid,
      text: text.trim(),
      timestamp: Date.now(),
      temp: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    const toSend = text.trim();
    setText('');
    try {
      await sendMessage(chatId, uid, { text: toSend });
      // Remove temp; real message arrives via snapshot
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } catch (e) {
      // Queue for retry on reconnect
      outboxRef.current[tempId] = { kind: 'text', text: toSend };
      startRetryLoop();
    }
    // Ensure we reveal the just-sent message immediately
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd?.({ animated: true });
      atBottomRef.current = true;
    });
  };

  const onPickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission required', 'Allow photo library access to send images.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!res.canceled) {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const uri = res.assets[0].uri;
      const tempId = `temp-img-${Date.now()}`;
      const optimistic: Message = {
        id: tempId,
        senderId: uid,
        imageUrl: uri,
        timestamp: Date.now(),
        temp: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        const imageUrl = await uploadChatImage(chatId, uri);
        await sendMessage(chatId, uid, { imageUrl });
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      } catch (e) {
        outboxRef.current[tempId] = { kind: 'image', uri };
        startRetryLoop();
      }
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd?.({ animated: true });
        atBottomRef.current = true;
      });
    }
  };

  const loadOlder = async () => {
    if (loadingOlder || !hasMoreOlder || !oldestCursor) return;
    setLoadingOlder(true);
    try {
      const ref = collection(db, 'chats', chatId, 'messages');
      const q = query(ref, orderBy('timestamp', 'desc'), startAfter(oldestCursor), limit(10));
      const snap = await getDocs(q);
      if (snap.empty) {
        setHasMoreOlder(false);
        return;
      }
      const desc = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any), __doc: d }));
      setOldestCursor(desc[desc.length - 1].__doc);
      const olderAsc = desc
        .slice()
        .reverse()
        .map(({ __doc, ...m }) => m as any);
      setMessages((prev) => {
        const map = new Map<string, any>();
        [...olderAsc, ...prev].forEach((m: any) => map.set(m.id, m));
        return Array.from(map.values()).sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        data={(function buildData() {
          const boundary = persistDividerRef.current && initialLastReadAtRef.current !== null
            ? (initialLastReadAtRef.current as number)
            : (lastReadAt as number);
          if (!boundary) return messages;
          const idx = messages.findIndex((m) => m.timestamp > boundary);
          if (idx <= 0) return messages;
          const arr: any[] = [...messages];
          arr.splice(idx, 0, { id: 'unread-divider', divider: true });
          return arr;
        })()}
        keyExtractor={(item) => item.id}
        onScrollToIndexFailed={(info) => {
          // Retry after measurement
          setTimeout(() => {
            try {
              listRef.current?.scrollToIndex?.({ index: info.index, animated: false, viewPosition: 0.3 });
            } catch {}
          }, 200);
        }}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
          atBottomRef.current = distanceFromBottom < 24; // near bottom
          if (contentOffset.y < 24) {
            loadOlder();
          }
        }}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 10 }}
        onViewableItemsChanged={({ viewableItems }) => {
          const uid = auth.currentUser?.uid;
          if (!uid) return;
          // If most recent visible message is newer than our lastReadAt, mark read
          const maxTs = viewableItems
            .filter((vi: any) => !vi.item?.divider && typeof vi.item?.timestamp === 'number')
            .reduce((m: number, vi: any) => Math.max(m, vi.item.timestamp as number), 0);
          if (maxTs > (lastReadAt ?? 0)) {
            const now = Date.now();
            if (now - lastMarkedRef.current > 500) {
              updateReadStatus(chatId, uid);
              lastMarkedRef.current = now;
            }
          }
        }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }: any) => {
          if (item.divider) {
            return (
              <View style={{ alignItems: 'center', marginVertical: 8 }}>
                <Text style={{ color: '#FF3B30' }}>New messages</Text>
              </View>
            );
          }
          const myUid = auth.currentUser?.uid;
          const isMine = item.senderId === myUid;
          // unread count for recipients (exclude sender)
          const otherMembers = members.filter((id) => id !== item.senderId);
          const readers = otherMembers.filter((id) => {
            const t = (readMap || {})[id];
            return typeof t === 'number' && t >= (item.timestamp || 0);
          }).length;
          const unread = Math.max(otherMembers.length - readers, 0);
          const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
          if (isMine) {
            const isLastRead = lastReadMessageId && item.id === lastReadMessageId;
            return (
              <View style={{ marginBottom: 8, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                {unread > 0 ? (
                  <Text style={{ fontSize: 10, color: '#999' }}>{unread}</Text>
                ) : null}
                {item.temp ? <Text style={{ fontSize: 11, color: '#999' }}>sending…</Text> : (timeStr ? <Text style={{ fontSize: 11, color: '#666' }}>{timeStr}</Text> : null)}
                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={{ width: Math.min(200, BUBBLE_MAX), height: 200, borderRadius: 8 }} />
                ) : (
                  <Text style={{ backgroundColor: '#eee', borderRadius: 8, padding: 8, maxWidth: BUBBLE_MAX, flexShrink: 1, color: isLastRead ? '#FF3B30' : undefined }}>{item.text}</Text>
                )}
              </View>
            );
          }
          const sender = profileCache[item.senderId];
          if (!sender) ensureProfile(item.senderId);
          return (
            <View style={{ marginBottom: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
              <Image source={sender?.photoURL ? { uri: sender.photoURL } : undefined} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#ddd' }} />
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, maxWidth: BUBBLE_MAX }}>
                <View style={{ maxWidth: BUBBLE_MAX }}>
                  {sender?.displayName ? (
                    <Text style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>{sender.displayName}</Text>
                  ) : null}
                  {item.imageUrl ? (
                    <Image source={{ uri: item.imageUrl }} style={{ width: Math.min(200, BUBBLE_MAX), height: 200, borderRadius: 8 }} />
                  ) : (
                    <Text style={{ backgroundColor: '#eee', borderRadius: 8, padding: 8, maxWidth: BUBBLE_MAX, flexShrink: 1, color: (lastReadMessageId && item.id === lastReadMessageId) ? '#FF3B30' : undefined }}>{item.text}</Text>
                  )}
                </View>
                {timeStr ? <Text style={{ fontSize: 11, color: '#666' }}>{timeStr}</Text> : null}
              </View>
            </View>
          );
        }}
      />
      {isSomeoneTyping ? (
        <Text style={{ textAlign: 'center', color: '#888', marginBottom: 4 }}>Typing…</Text>
      ) : null}
      <View style={{ flexDirection: 'row', padding: 8, gap: 8, alignItems: 'center' }}>
        <TouchableOpacity onPress={onPickImage} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
          <Text>📎</Text>
        </TouchableOpacity>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            const uid = auth.currentUser?.uid;
            if (!uid) return;
            // mark typing true and debounce to false
            const typingDoc = doc(db, 'chats', chatId, 'typing', uid);
            import('firebase/firestore').then(({ setDoc }) => setDoc(typingDoc, { typing: true, updatedAt: Date.now() }, { merge: true }));
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => {
              import('firebase/firestore').then(({ setDoc }) => setDoc(typingDoc, { typing: false, updatedAt: Date.now() }, { merge: true }));
            }, 1500);
          }}
          placeholder="Type a message"
          style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
        />
        <Button title="Send" onPress={onSend} />
      </View>
    </KeyboardAvoidingView>
  );
}


