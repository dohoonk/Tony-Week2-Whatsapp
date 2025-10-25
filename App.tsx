import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './navigation/AppNavigator';
import { AuthProvider } from './contexts/AuthContext';
import { ChatProvider } from './contexts/ChatContext';
import { TripProvider } from './contexts/TripContext';
import './firebase/config';
import { onAuthStateChanged } from './firebase/authService';
import LoginScreen from './screens/Auth/LoginScreen';
import { View, ActivityIndicator, AppState, Platform, ToastAndroid } from 'react-native';
import OnboardingScreen from './screens/Auth/OnboardingScreen';
import { getUserProfile } from './firebase/userService';
import { registerForPushNotificationsAsync } from './lib/notifications';
import { doc, setDoc, arrayUnion, collection, query, where, onSnapshot, orderBy, limit, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from './firebase/config';
import * as Notifications from 'expo-notifications';
import { NavigationContainerRefWithCurrent } from '@react-navigation/native';

export default function App() {
  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState<any>(null);
  const [needsOnboarding, setNeedsOnboarding] = React.useState(false);
  const navRef = React.useRef<any>(null);
  const currentChatIdRef = React.useRef<string | null>(null);
  const debugPresence = (message: string) => {
    if (__DEV__) {
      try { console.log(message); } catch {}
      if (Platform.OS === 'android') {
        try { ToastAndroid.show(message, ToastAndroid.SHORT); } catch {}
      }
    }
  };

  React.useEffect(() => {
    // Handle tapping on local notification to navigate to chat
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const chatId = resp.notification.request.content.data?.chatId as string | undefined;
      if (chatId && navRef.current) {
        navRef.current.navigate('Chats', { screen: 'ChatRoom', params: { chatId } });
      }
    });
    // Mark reminders as notified when the notification is received in foreground
    const onRecv = Notifications.addNotificationReceivedListener(async (notif) => {
      try {
        const rid = (notif as any)?.request?.content?.data?.reminderId as string | undefined;
        if (rid) {
          // Idempotent notified update
          try {
            const rSnap = await getDoc(doc(db, 'reminders', rid));
            const st = String((rSnap.data() as any)?.status || 'scheduled');
            if (st === 'scheduled') {
              await updateDoc(doc(db, 'reminders', rid), { status: 'notified' });
            }
          } catch {}
        }
      } catch {}
    });
    return () => { sub.remove(); onRecv.remove(); };
  }, []);

  // Track currently focused chat id from a global set by ChatRoomScreen
  React.useEffect(() => {
    const id = setInterval(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cid = (global as any).__currentChatId as string | undefined;
        currentChatIdRef.current = cid ?? null;
      } catch {}
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Log that app mounted (dev only)
  React.useEffect(() => {
    try { if (__DEV__) console.log('App mounted: dev logging enabled'); } catch {}
  }, []);

  // Debug: show Firebase projectId in Metro logs
  React.useEffect(() => {
    try {
      if (__DEV__) console.log('Firebase projectId', (db as any).app?.options?.projectId);
    } catch {}
  }, []);

  React.useEffect(() => {
    const unsub = onAuthStateChanged(async (u) => {
      setUser(u);
      try { if (__DEV__) console.log('Auth state changed. uid =', u?.uid || 'null'); } catch {}
      if (u?.uid) {
        try {
          const profile = await getUserProfile(u.uid);
          setNeedsOnboarding(!profile);
        } catch (e) {
          try { console.log('getUserProfile error:', (e as any)?.message || e); } catch {}
        }
        try {
          const token = await registerForPushNotificationsAsync();
          if (token) {
            const userRef = doc(db, 'users', u.uid);
            await setDoc(userRef, { pushTokens: arrayUnion(token) }, { merge: true });
          }
        } catch (e) {
          try { console.log('Push token register error:', (e as any)?.message || e); } catch {}
        }
        // Presence: mark online and keep heartbeat while app active
        const presenceRef = doc(db, 'presence', u.uid);
        const userPresenceUserRef = doc(db, 'users', u.uid);
        const setOnline = async () => {
          const now = Date.now();
          try {
            debugPresence('Presence write start: online');
            await Promise.all([
              setDoc(presenceRef, { state: 'online', online: true, lastChanged: now }, { merge: true }),
              setDoc(userPresenceUserRef, { status: 'online', online: true, lastSeen: now, updatedAt: now }, { merge: true }),
            ]);
            debugPresence('Presence: online');
          } catch (e: any) {
            try { console.log('Presence write error (online):', e?.message || e); } catch {}
          }
        };
        const setOffline = async () => {
          const now = Date.now();
          try {
            debugPresence('Presence write start: offline');
            await Promise.all([
              setDoc(presenceRef, { state: 'offline', online: false, lastChanged: now }, { merge: true }),
              setDoc(userPresenceUserRef, { status: 'offline', online: false, lastSeen: now, updatedAt: now }, { merge: true }),
            ]);
            debugPresence('Presence: offline');
          } catch (e: any) {
            try { console.log('Presence write error (offline):', e?.message || e); } catch {}
          }
        };
        await setOnline();
        let presenceInterval: any = setInterval(setOnline, 5000);
        const appStateSub = AppState.addEventListener('change', async (state) => {
          try { if (__DEV__) console.log('AppState change:', state); } catch {}
          if (state === 'active') {
            setOnline();
            if (!presenceInterval) presenceInterval = setInterval(setOnline, 5000);
            // Auto-expire overdue reminders on foreground
            try {
              const rq = query(collection(db, 'reminders'), where('members', 'array-contains', u.uid));
              const snap = await getDocs(rq);
              const now = Date.now();
              for (const d of snap.docs) {
                const r: any = d.data() || {};
                const st = String(r?.status || 'scheduled');
                const dueAt: number | undefined = typeof r?.dueAt === 'number' ? r.dueAt : (r?.dueAt?.toMillis?.() ?? undefined);
                if ((st === 'scheduled' || st === 'notified') && dueAt && dueAt < now) {
                  try { await updateDoc(doc(db, 'reminders', d.id), { status: 'expired' } as any); } catch {}
                }
              }
            } catch {}
          } else if (state === 'background' || state === 'inactive') {
            setOffline();
            if (presenceInterval) {
              clearInterval(presenceInterval);
              presenceInterval = null;
            }
          }
        });
        // Global foreground notification for any new messages
        // Subscribe to the user's chats and watch the latest message
        const chatsRef = collection(db, 'chats');
        const cq = query(chatsRef, where('members', 'array-contains', u.uid));
        const perChatSubs = new Map<string, () => void>();
        const lastNotified = new Map<string, number>();
        const lastNotifiedId = new Map<string, string>();
        const unsubChats = onSnapshot(cq, async (chatsSnap) => {
          const currentIds = new Set<string>();
          chatsSnap.forEach((c) => currentIds.add(c.id));

          // Add listeners for newly discovered chats
          for (const chatId of Array.from(currentIds)) {
            if (perChatSubs.has(chatId)) return;
            // Initialize baseline from chat's lastMessageAt if available
            try {
              const chatSnap = await getDoc(doc(db, 'chats', chatId));
              const cd: any = chatSnap.data() || {};
              const lm = cd?.lastMessageAt;
              const base = typeof lm === 'number' ? lm : (lm?.toMillis?.() ?? 0);
              if (!lastNotified.has(chatId)) lastNotified.set(chatId, base);
              try { if (__DEV__) console.log('Notif attach for chat', chatId, 'baseline', base); } catch {}
            } catch {}
            const latestRef = query(
              collection(db, 'chats', chatId, 'messages'),
              orderBy('timestamp', 'desc'),
              limit(1)
            );
            const unsubLatest = onSnapshot(latestRef, async (msgSnap) => {
              if (msgSnap.empty) return;
              const doc0 = msgSnap.docs[0];
              const msgId = doc0.id;
              const m: any = doc0.data();
              if (!m?.timestamp) return;
              // Initialize baseline to 'now' so the next incoming message triggers immediately
              if (!lastNotified.has(chatId)) lastNotified.set(chatId, Date.now());
              const prev = lastNotified.get(chatId) ?? 0;
              const msgTs = typeof m.timestamp === 'number' ? m.timestamp : (m.timestamp?.toMillis?.() ?? 0);
              const sameId = lastNotifiedId.get(chatId) === msgId;
              const willNotify = !sameId && (msgTs > prev) && m.senderId !== u.uid;
              try { if (__DEV__) console.log('Notif check', { chatId, msgId, msgTs, prev, senderId: m.senderId, willNotify }); } catch {}
              if (!willNotify) return;
              lastNotified.set(chatId, msgTs);
              lastNotifiedId.set(chatId, msgId);

              // Build title from chat data; special case poll results
              let title = m?.relatedFeature === 'poll_result' ? 'Poll closed' : 'New message';
              const chatData: any = (await getDoc(doc(db, 'chats', chatId))).data() || {};
              if (chatData?.type === 'group' && chatData?.groupName) {
                title = chatData.groupName;
              } else {
                // direct chat: get sender profile for name/avatar
                const senderSnap = await getDoc(doc(db, 'users', m.senderId));
                const sp = senderSnap.data() as any;
                title = sp?.displayName || 'New message';
              }
              // Suppress if I'm currently viewing this chat
              if (currentChatIdRef.current !== chatId) {
                const body = m.text ? String(m.text) : 'Sent a photo';
                const { showLocalNotification } = await import('./lib/notifications');
                showLocalNotification(title, body, { chatId });
              }
            });
            perChatSubs.set(chatId, unsubLatest);
          }

          // Remove listeners for chats no longer present
          for (const [chatId, unsub] of Array.from(perChatSubs.entries())) {
            if (!currentIds.has(chatId)) {
              unsub();
              perChatSubs.delete(chatId);
              lastNotified.delete(chatId);
            }
          }
        });

        // Foreground reminders: schedule local notif at dueAt for my reminders
        const scheduledReminderNotifs = new Map<string, string>();
        const remindersRef = collection(db, 'reminders');
        const rq = query(remindersRef, where('members', 'array-contains', u.uid));
        const unsubReminders = onSnapshot(rq, async (snap) => {
          const nowTs = Date.now();
          const seen = new Set<string>();
          for (const d of snap.docs) {
            const r: any = d.data() || {};
            if (r?.status !== 'scheduled') continue;
            const dueAt: number | undefined = typeof r?.dueAt === 'number' ? r.dueAt : (r?.dueAt?.toMillis?.() ?? undefined);
            if (!dueAt || dueAt <= nowTs) continue;
            seen.add(d.id);
            const existingId = scheduledReminderNotifs.get(d.id);
            // If already scheduled, skip
            if (existingId) continue;
            try {
              const notifId = await Notifications.scheduleNotificationAsync({
                content: {
                  title: 'Reminder',
                  body: String(r?.title || 'Reminder'),
                  data: { chatId: String(r?.chatId || ''), reminderId: d.id },
                },
                trigger: new Date(dueAt) as any,
              });
              scheduledReminderNotifs.set(d.id, notifId);
              try { if (__DEV__) console.log('Reminder scheduled', d.id, new Date(dueAt).toISOString()); } catch {}
            } catch (e) {
              // ignore
            }
          }
          // Cancel any that disappeared or changed status
          for (const [rid, notifId] of Array.from(scheduledReminderNotifs.entries())) {
            if (!seen.has(rid)) {
              try { await Notifications.cancelScheduledNotificationAsync(notifId); } catch {}
              scheduledReminderNotifs.delete(rid);
            }
          }
        });
        // Store cleanup on window for this session
        (global as any).__chatUnsubs && (global as any).__chatUnsubs();
        (global as any).__chatUnsubs = () => {
          unsubChats();
          unsubReminders();
          for (const [, unsub] of perChatSubs) unsub();
          perChatSubs.clear();
          lastNotified.clear();
          appStateSub.remove();
          if (presenceInterval) clearInterval(presenceInterval);
          // Best-effort offline write when tearing down (e.g., app close)
          setOffline();
        };
      } else {
        setNeedsOnboarding(false);
        (global as any).__chatUnsubs && (global as any).__chatUnsubs();
      }
      setReady(true);
    });
    return () => unsub();
  }, []);

  // DEBUG: log an ID token after sign-in (remove after testing)
  React.useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        // force refresh to ensure a valid token
        // @ts-ignore
        const token = await user.getIdToken?.(true);
        if (token && __DEV__) console.log('ID_TOKEN', token);
      } catch {}
    })();
  }, [user]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navRef}>
      {!user ? (
        <LoginScreen />
      ) : needsOnboarding ? (
        <OnboardingScreen onDone={() => setNeedsOnboarding(false)} />
      ) : (
        <AuthProvider user={user}>
          <ChatProvider>
            <TripProvider>
              <AppNavigator />
            </TripProvider>
          </ChatProvider>
        </AuthProvider>
      )}
    </NavigationContainer>
  );
}
