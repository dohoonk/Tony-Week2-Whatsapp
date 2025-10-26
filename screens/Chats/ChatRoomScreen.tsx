import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, Button, Image, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, Dimensions, AppState, Modal, ActivityIndicator, LayoutAnimation, UIManager } from 'react-native';
import Banner from '../../components/Banner';
import AppText from '../../components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import NetInfo from '@react-native-community/netinfo';
import { RouteProp, useRoute, useNavigation, useIsFocused } from '@react-navigation/native';
import { ChatsStackParamList } from '../../navigation/ChatsStack';
import { collection, onSnapshot, orderBy, query, doc, getDoc, limit, startAfter, getDocs, where } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { auth } from '../../firebase/config';
import { sendMessage, updateReadStatus } from '../../firebase/chatService';
import * as ImagePicker from 'expo-image-picker';
import { uploadChatImage } from '../../firebase/storageService';
import { showLocalNotification } from '../../lib/notifications';
import { fetchDraft, shareDraft } from '../../lib/ai';
import PollCard from '../../components/PollCard';

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
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight ? useHeaderHeight() : 0;
  const route = useRoute<RouteProp<ChatsStackParamList, 'ChatRoom'>>();
  const navigation = useNavigation();
  const { chatId } = route.params;
  const isFocused = useIsFocused();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [lastReadAt, setLastReadAt] = useState<number | null>(null);
  const [isSomeoneTyping, setIsSomeoneTyping] = useState(false);
  const [typingIds, setTypingIds] = useState<string[]>([]);
  const typingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const prevCountRef = React.useRef<number>(0);
  const listRef = React.useRef<FlatList<any>>(null);
  const hasLoadedRef = React.useRef<boolean>(false);
  const atBottomRef = React.useRef<boolean>(true);
  const [readMap, setReadMap] = useState<Record<string, any>>({});
  const [members, setMembers] = useState<string[]>([]);
  const [chatMeta, setChatMeta] = useState<{ tripId?: string | null; pollId?: string | null; reminderId?: string | null }>({});
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
  const markedOnOpenRef = React.useRef<boolean>(false);
  const outboxRef = React.useRef<Record<string, { kind: 'text' | 'image'; text?: string; uri?: string }>>({});
  const retryTimerRef = React.useRef<any>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewText, setPreviewText] = useState<string>('');
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [menuForId, setMenuForId] = useState<string | null>(null);
  const [currentTool, setCurrentTool] = useState<'summarize' | 'poll' | 'reminder' | 'trip' | 'weather'>('summarize');
  const [reminderDueAt, setReminderDueAt] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingCount, setPendingCount] = useState<number>(0);
  // Enable LayoutAnimation on Android
  useEffect(() => {
    try { UIManager.setLayoutAnimationEnabledExperimental && UIManager.setLayoutAnimationEnabledExperimental(true); } catch {}
  }, []);

  const parseDueAtFromText = (text: string): number | null => {
    try {
      const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      const isTomorrow = /tomorrow/i.test(text);
      const isToday = /today/i.test(text);
      if (!timeMatch) return null;
      const hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3].toUpperCase();
      const base = new Date();
      if (isTomorrow) base.setDate(base.getDate() + 1);
      // default to today unless explicitly "tomorrow"
      const h24 = (hour % 12) + (ampm === 'PM' ? 12 : 0);
      base.setHours(h24, minute, 0, 0);
      return base.getTime();
    } catch {
      return null;
    }
  };

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
    // Set/clear the globally tracked focused chat for notification suppression
    try {
      (global as any).__currentChatId = isFocused ? chatId : null;
      (global as any).__isChatRoomFocused = !!isFocused;
      if (__DEV__) {
        try { console.log('ChatRoomScreen focus state', { chatId, isFocused }); } catch {}
      }
    } catch {}
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
      setChatMeta({ tripId: data?.tripId ?? null, pollId: data?.pollId ?? null, reminderId: data?.reminderId ?? null });
    });
    // Prime initial lastReadAt before messages subscription so divider renders on first paint
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'chats', chatId));
        const data: any = snap.data() || {};
        const uid = auth.currentUser?.uid;
        if (uid && initialLastReadAtRef.current === null) {
          const rs = data?.readStatus || {};
          const entry: any = rs[uid];
          const at = typeof entry === 'object' && typeof entry?.at === 'number' ? entry.at : (typeof entry === 'number' ? entry : null);
          initialLastReadAtRef.current = at;
          persistDividerRef.current = true;
          if (!markedOnOpenRef.current) {
            try { await updateReadStatus(chatId, uid); } catch {}
            markedOnOpenRef.current = true;
          }
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
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMessages((prev) => {
        const map = new Map<string, any>();
        [...prev, ...liveAsc].forEach((m: any) => map.set(m.id, m));
        return Array.from(map.values()).sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
      });
      const uid = auth.currentUser?.uid;
      // Mark read immediately when at (or near) the bottom
      if (uid && hasLoadedRef.current && atBottomRef.current) {
        updateReadStatus(chatId, uid);
        lastMarkedRef.current = Date.now();
      }
      // Foreground local notification for new incoming message
      const prev = prevCountRef.current;
      if (liveAsc.length > prev) {
        const last = liveAsc[liveAsc.length - 1];
        const myUid = auth.currentUser?.uid;
        if (last && last.senderId !== myUid) {
          const body = last.text ? String(last.text) : 'Sent a photo';
          showLocalNotification('New message', body);
        } else if (last && last.senderId === myUid && (atBottomRef.current)) {
          // If I just sent a message, scroll to bottom to reveal it
          requestAnimationFrame(() => {
            listRef.current?.scrollToEnd?.({ animated: true });
            atBottomRef.current = true;
          });
        }
      }
      prevCountRef.current = liveAsc.length;
      if (!hasLoadedRef.current) hasLoadedRef.current = true;
    });
    return () => { unsub(); unsubTitle(); };
  }, [chatId, isFocused]);

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
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        delete outboxRef.current[tempId];
        // if queue empty, stop timer
        const remaining = Object.keys(outboxRef.current).length;
        setPendingCount(remaining);
        if (remaining === 0 && retryTimerRef.current) {
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
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        delete outboxRef.current[tempId];
        setPendingCount(Object.keys(outboxRef.current).length);
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
        setPendingCount(Object.keys(outboxRef.current).length);
      }
    });
    return () => sub.remove();
  }, []);

  // Listen to connectivity changes and run catch-up immediately on reconnect
  useEffect(() => {
    const unsub = NetInfo.addEventListener(async (state) => {
      const online = !!state.isConnected && (state.isInternetReachable !== false);
      setIsOnline(online);
      if (online) {
        // Immediate outbox flush
        try {
          await flushOutboxNow();
          startRetryLoop();
          setPendingCount(Object.keys(outboxRef.current).length);
        } catch {}
        // One-shot catch-up for any messages newer than our max timestamp
        try {
          const maxTs = messages.length > 0 ? (messages[messages.length - 1]?.timestamp || 0) : 0;
          if (maxTs > 0) {
            const ref = collection(db, 'chats', chatId, 'messages');
            const qy = query(ref, orderBy('timestamp', 'asc'), where('timestamp', '>', maxTs), limit(100));
            const snap = await getDocs(qy);
            if (!snap.empty) {
              const newer = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
              setMessages((prev) => {
                const map = new Map<string, any>();
                [...prev, ...newer].forEach((m: any) => map.set(m.id, m));
                return Array.from(map.values()).sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
              });
            }
          }
        } catch {}
      }
    });
    // Set initial state once
    NetInfo.fetch().then((state) => setIsOnline(!!state.isConnected && (state.isInternetReachable !== false))).catch(() => {});
    return () => unsub();
  }, [chatId]);

  // Compute the index of the first unread message (in raw messages),
  // anchored to the entry-time read boundary so the divider persists until unmount
  const firstUnreadIndex = React.useMemo(() => {
    const myUid = auth.currentUser?.uid;
    const boundaryEntry: any = initialReadEntryRef.current || null;
    const boundaryAt = boundaryEntry && typeof boundaryEntry?.at === 'number' ? boundaryEntry.at : (initialLastReadAtRef.current as number | null);
    const boundary = boundaryAt ?? lastReadAt;
    if (!boundary || messages.length === 0) return null;
    const idx = messages.findIndex((m) => (m?.timestamp ?? 0) > boundary && m?.senderId !== myUid);
    return idx >= 0 ? idx : null;
  }, [messages, lastReadAt]);

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
      try {
        (global as any).__currentChatId = null;
        (global as any).__isChatRoomFocused = false;
        if (__DEV__) {
          try { console.log('ChatRoomScreen unmount; cleared focus globals', { chatId }); } catch {}
        }
      } catch {}
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
      const entry: any = rs[uid];
      const current = typeof entry === 'object' && typeof entry?.at === 'number' ? entry.at : (typeof entry === 'number' ? entry : null);
      setLastReadAt(current);
      if (initialLastReadAtRef.current === null) {
        initialLastReadAtRef.current = current;
        // Persist divider for the session; we will clear on unmount
        persistDividerRef.current = true;
        if (!markedOnOpenRef.current) {
          // Ensure we mark all as read once on open after capturing boundary
          updateReadStatus(chatId, uid);
          markedOnOpenRef.current = true;
        }
      }
    });
    return () => unsub();
  }, [chatId]);

  // Typing indicator listeners
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    const typingRef = collection(db, 'chats', chatId, 'typing');
    const unsub = onSnapshot(typingRef, (snap) => {
      const active: string[] = [];
      snap.forEach((d) => {
        const data: any = d.data();
        if (d.id !== uid && data?.typing) active.push(d.id);
      });
      setIsSomeoneTyping(active.length > 0);
      setTypingIds(active);
    });
    return () => unsub();
  }, [chatId]);

  // Resolve typing names from profiles
  const typingNames = React.useMemo(() => {
    if (!typingIds || typingIds.length === 0) return '';
    const names: string[] = [];
    typingIds.forEach((id) => {
      const prof = profileCache[id];
      if (!prof) ensureProfile(id);
      const nm = prof?.displayName || id;
      names.push(String(nm));
    });
    if (names.length === 0) return '';
    if (names.length <= 3) return `${names.join(', ')} typing…`;
    return `${names.slice(0, 3).join(', ')} ++ typing…`;
  }, [typingIds, profileCache]);

  const parseMention = (raw: string): { isTM: boolean; prompt: string; tool: 'summarize' | 'poll' | 'reminder' | 'trip' | 'weather' | 'general' } => {
    const txt = raw.trim();
    const mentionMatch = /^@(tm|tripmate|tripmateai)\b\s*(.*)$/i.exec(txt);
    if (!mentionMatch) return { isTM: false, prompt: '', tool: 'general' };
    const prompt = (mentionMatch[2] || '').trim();
    const lower = prompt.toLowerCase();
    let tool: 'summarize' | 'poll' | 'reminder' | 'trip' | 'weather' | 'general' = 'general';
    if (/\b(summarize|recap|tl;dr)\b/.test(lower)) tool = 'summarize';
    else if (/\b(poll|vote|options?)\b/.test(lower)) tool = 'poll';
    else if (/\b(reminder|remind|today|tomorrow|at\s+\d)\b/.test(lower)) tool = 'reminder';
    else if (/\b(weather|forecast|temp|temperature)\b/.test(lower)) tool = 'weather';
    else if (/\b(trip|itinerary|plan)\b/.test(lower)) tool = 'trip';
    return { isTM: true, prompt, tool };
  };

  const onSend = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !text.trim()) return;
    // @TM interception: open AI preview instead of sending user text
    const { isTM, prompt, tool } = parseMention(text);
    if (isTM) {
      try {
        setLoadingDraft(true);
        const requested = tool === 'general' ? 'auto' : tool;
        const draft = await fetchDraft(chatId, requested, { prompt });
        const resolvedTool = (draft as any)?.tool || (tool === 'general' ? 'summarize' : tool);
        setCurrentTool(resolvedTool);
        setPreviewText(draft.text || '');
        if (resolvedTool === 'reminder') {
          const parsed = parseDueAtFromText(draft.text || prompt || '');
          setReminderDueAt(parsed ?? (Date.now() + 60 * 60 * 1000));
        }
        setPreviewVisible(true);
      } catch (e: any) {
        Alert.alert('TripMate AI failed', String(e?.message || e));
      } finally {
        setLoadingDraft(false);
      }
      return;
    }
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
    // Reveal just-sent message only if already near bottom
    if (atBottomRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd?.({ animated: true });
        atBottomRef.current = true;
      });
    }
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
      if (atBottomRef.current) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToEnd?.({ animated: true });
          atBottomRef.current = true;
        });
      }
    }
  };

  const onAskAIDraft = async () => {
    try {
      setLoadingDraft(true);
      setCurrentTool('summarize');
      const draft = await fetchDraft(chatId, 'summarize');
      setPreviewText(draft.text || '');
      setPreviewVisible(true);
    } catch (e: any) {
      Alert.alert('AI Draft failed', String(e?.message || e));
    } finally {
      setLoadingDraft(false);
    }
  };

  const onAIMenuAction = async (tool: 'summarize' | 'poll' | 'reminder' | 'trip' | 'weather') => {
    try {
      setMenuForId(null);
      setLoadingDraft(true);
      setCurrentTool(tool);
      if (tool === 'reminder') {
        setReminderDueAt(null); // reset before loading
      }
      const draft = await fetchDraft(chatId, tool);
      setPreviewText(draft.text || '');
      if (tool === 'reminder') {
        const parsed = parseDueAtFromText(draft.text || '');
        setReminderDueAt(parsed ?? (Date.now() + 60 * 60 * 1000));
      }
      setPreviewVisible(true);
    } catch (e: any) {
      Alert.alert('AI Draft failed', String(e?.message || e));
    } finally {
      setLoadingDraft(false);
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
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMessages((prev) => {
        const map = new Map<string, any>();
        [...olderAsc, ...prev].forEach((m: any) => map.set(m.id, m));
        return Array.from(map.values()).sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  // Backfill older pages automatically until the unread boundary is included (or we reach limits)
  const backfillingRef = React.useRef<boolean>(false);
  const backfillAttemptsRef = React.useRef<number>(0);
  useEffect(() => {
    const boundary = (initialLastReadAtRef.current ?? lastReadAt) as number | null;
    if (!boundary) return;
    if (firstUnreadIndex !== null) return; // already found within loaded set
    if (messages.length === 0) return;
    const earliestTs = messages[0]?.timestamp || 0;
    if (earliestTs <= boundary) return; // we have messages at/older than boundary
    if (!hasMoreOlder || !oldestCursor) return;
    if (backfillingRef.current || backfillAttemptsRef.current >= 5) return;
    backfillingRef.current = true;
    backfillAttemptsRef.current += 1;
    (async () => {
      try { await loadOlder(); } finally { backfillingRef.current = false; }
    })();
  }, [messages, firstUnreadIndex, hasMoreOlder, oldestCursor, lastReadAt]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? (headerHeight || 0) : 0}
    >
      {!isOnline ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Banner kind="error">Offline – messages will send when reconnected</Banner>
        </View>
      ) : null}
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
            updateReadStatus(chatId, uid);
            lastMarkedRef.current = Date.now();
          }
        }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }: any) => {
          const isFirstUnread = firstUnreadIndex !== null && index === firstUnreadIndex;
          if (item.divider) {
            return (
              <View style={{ alignItems: 'center', marginVertical: 8 }}>
                <AppText variant="meta" style={{ color: '#FF3B30' }}>New messages</AppText>
              </View>
            );
          }
          const myUid = auth.currentUser?.uid;
          const isMine = item.senderId === myUid;
          const isAI = item.senderId === 'ai' || item.type === 'ai_response';
          // unread count for recipients (exclude sender)
          const otherMembers = members.filter((id) => id !== item.senderId);
          const readers = otherMembers.filter((id) => {
            const t: any = (readMap || {})[id];
            if (typeof t === 'number') return t >= (item.timestamp || 0);
            if (t && typeof t === 'object' && typeof t.at === 'number') return t.at >= (item.timestamp || 0);
            return false;
          }).length;
          const unread = Math.max(otherMembers.length - readers, 0);
          const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
          if (isMine) {
            const isLastRead = lastReadMessageId && item.id === lastReadMessageId;
            return (
              <TouchableOpacity onLongPress={() => setMenuForId(item.id)} activeOpacity={0.9} style={{ marginBottom: 8, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                {unread > 0 ? (
                  <AppText variant="meta" style={{ color: '#999' }}>{unread}</AppText>
                ) : null}
                {item.temp ? <AppText variant="meta" style={{ color: '#999' }}>sending…</AppText> : (timeStr ? <AppText variant="meta" style={{ color: '#666' }}>{timeStr}</AppText> : null)}
                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={{ width: Math.min(200, BUBBLE_MAX), height: 200, borderRadius: 8 }} />
                ) : (
                  <Text style={{ backgroundColor: '#eee', borderRadius: 8, padding: 8, maxWidth: BUBBLE_MAX, flexShrink: 1, color: isFirstUnread ? '#10B981' : (isLastRead ? '#FF3B30' : undefined) }}>{item.text}</Text>
                )}
              </TouchableOpacity>
            );
          }
          if (isAI && item?.relatedFeature === 'poll' && item?.relatedId) {
            return (
              <View style={{ marginBottom: 8, alignSelf: 'stretch' }}>
                <PollCard pollId={String(item.relatedId)} chatId={chatId} members={members} />
              </View>
            );
          }
          if (isAI) {
            return (
              <View style={{ marginBottom: 8, alignSelf: 'flex-start', maxWidth: BUBBLE_MAX }}>
                <AppText variant="meta" style={{ color: '#6B7280', marginBottom: 2 }}>TripMate AI</AppText>
                <Text style={{ backgroundColor: '#E5F3FF', borderRadius: 8, padding: 8 }}>{item.text}</Text>
              </View>
            );
          }
          const sender = profileCache[item.senderId];
          if (!sender) ensureProfile(item.senderId);
          return (
            <TouchableOpacity onLongPress={() => setMenuForId(item.id)} activeOpacity={0.9} style={{ marginBottom: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
              <Image source={sender?.photoURL ? { uri: sender.photoURL } : undefined} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#ddd' }} />
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, maxWidth: BUBBLE_MAX }}>
                <View style={{ maxWidth: BUBBLE_MAX }}>
                  {sender?.displayName ? (
                    <AppText variant="meta" style={{ color: '#888', marginBottom: 2 }}>{sender.displayName}</AppText>
                  ) : null}
                  {item.imageUrl ? (
                    <Image source={{ uri: item.imageUrl }} style={{ width: Math.min(200, BUBBLE_MAX), height: 200, borderRadius: 8 }} />
                  ) : (
                    <Text style={{ backgroundColor: '#eee', borderRadius: 8, padding: 8, maxWidth: BUBBLE_MAX, flexShrink: 1, color: isFirstUnread ? '#10B981' : ((lastReadMessageId && item.id === lastReadMessageId) ? '#FF3B30' : undefined) }}>{item.text}</Text>
                  )}
                </View>
                {unread > 0 ? (
                  <AppText variant="meta" style={{ color: '#999' }}>{unread}</AppText>
                ) : null}
                {timeStr ? <AppText variant="meta" style={{ color: '#666' }}>{timeStr}</AppText> : null}
              </View>
            </TouchableOpacity>
          );
        }}
      />
      {chatMeta?.tripId ? (
        <Text style={{ textAlign: 'center', color: '#2563EB', marginBottom: 4 }}>Trip linked · {String(chatMeta.tripId).slice(0, 8)}…</Text>
      ) : null}
      {typingNames ? (
        <AppText variant="meta" style={{ textAlign: 'center', color: '#888', marginBottom: 4 }}>{typingNames}</AppText>
      ) : null}
      <View style={{ flexDirection: 'row', padding: 8, gap: 8, alignItems: 'center' }}>
        <TouchableOpacity onPress={onPickImage} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
          <Text>📎</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onAskAIDraft} style={{ paddingHorizontal: 8, paddingVertical: 6 }} disabled={loadingDraft}>
          {loadingDraft ? <ActivityIndicator size="small" /> : <Text>✨</Text>}
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

      <Modal visible={previewVisible} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16 }}>
            <Text style={{ fontWeight: '600', fontSize: 16, marginBottom: 8 }}>AI Draft ({currentTool})</Text>
            {currentTool === 'reminder' ? (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ marginBottom: 8 }}>{previewText}</Text>
                <Text style={{ fontWeight: '500', marginBottom: 4 }}>Send at</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Button title="-15m" onPress={() => setReminderDueAt((d) => (d ? d - 15 * 60 * 1000 : Date.now()))} />
                  <Button title="+15m" onPress={() => setReminderDueAt((d) => (d ? d + 15 * 60 * 1000 : Date.now()))} />
                  <Text>{reminderDueAt ? new Date(reminderDueAt).toLocaleString() : 'unset'}</Text>
                </View>
              </View>
            ) : (
              <Text style={{ marginBottom: 16 }}>{previewText}</Text>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
              <TouchableOpacity onPress={() => { setPreviewVisible(false); setReminderDueAt(null); }}>
                <Text style={{ color: '#666' }}>Discard</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={async () => { try { await shareDraft(chatId, currentTool, previewText, currentTool === 'reminder' ? reminderDueAt ?? undefined : undefined); setPreviewVisible(false); } catch (e: any) { Alert.alert('Share failed', String(e?.message || e)); } }}>
                <Text style={{ color: '#007AFF' }}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!menuForId} transparent animationType="fade" onRequestClose={() => setMenuForId(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'center', padding: 24 }} activeOpacity={1} onPress={() => setMenuForId(null)}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16 }}>
            <Text style={{ fontWeight: '600', fontSize: 16, marginBottom: 12 }}>TripMate AI</Text>
            <TouchableOpacity onPress={() => onAIMenuAction('summarize')} style={{ paddingVertical: 10 }}>
              <Text>Summarize thread</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onAIMenuAction('poll')} style={{ paddingVertical: 10 }}>
              <Text>Create poll</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onAIMenuAction('reminder')} style={{ paddingVertical: 10 }}>
              <Text>Add reminder</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onAIMenuAction('trip')} style={{ paddingVertical: 10 }}>
              <Text>Plan trip</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onAIMenuAction('weather')} style={{ paddingVertical: 10 }}>
              <Text>Weather</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}


