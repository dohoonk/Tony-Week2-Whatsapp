import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './navigation/AppNavigator';
import './firebase/config';
import { onAuthStateChanged } from './firebase/authService';
import LoginScreen from './screens/Auth/LoginScreen';
import { View, ActivityIndicator } from 'react-native';
import OnboardingScreen from './screens/Auth/OnboardingScreen';
import { getUserProfile } from './firebase/userService';
import { registerForPushNotificationsAsync } from './lib/notifications';
import { doc, setDoc, arrayUnion, collection, query, where, onSnapshot, orderBy, limit, getDoc } from 'firebase/firestore';
import { db } from './firebase/config';
import * as Notifications from 'expo-notifications';
import { NavigationContainerRefWithCurrent } from '@react-navigation/native';

export default function App() {
  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState<any>(null);
  const [needsOnboarding, setNeedsOnboarding] = React.useState(false);
  const navRef = React.useRef<any>(null);

  React.useEffect(() => {
    // Handle tapping on local notification to navigate to chat
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const chatId = resp.notification.request.content.data?.chatId as string | undefined;
      if (chatId && navRef.current) {
        navRef.current.navigate('Chats', { screen: 'ChatRoom', params: { chatId } });
      }
    });
    return () => sub.remove();
  }, []);

  React.useEffect(() => {
    const unsub = onAuthStateChanged(async (u) => {
      setUser(u);
      if (u?.uid) {
        const profile = await getUserProfile(u.uid);
        setNeedsOnboarding(!profile);
        const token = await registerForPushNotificationsAsync();
        if (token) {
          const userRef = doc(db, 'users', u.uid);
          await setDoc(userRef, { pushTokens: arrayUnion(token) }, { merge: true });
        }
        // Global foreground notification for any new messages
        // Subscribe to the user's chats and watch the latest message
        const chatsRef = collection(db, 'chats');
        const cq = query(chatsRef, where('members', 'array-contains', u.uid));
        const perChatSubs = new Map<string, () => void>();
        const lastNotified = new Map<string, number>();
        const unsubChats = onSnapshot(cq, (chatsSnap) => {
          const currentIds = new Set<string>();
          chatsSnap.forEach((c) => currentIds.add(c.id));

          // Add listeners for newly discovered chats
          currentIds.forEach((chatId) => {
            if (perChatSubs.has(chatId)) return;
            const latestRef = query(
              collection(db, 'chats', chatId, 'messages'),
              orderBy('timestamp', 'desc'),
              limit(1)
            );
            const unsubLatest = onSnapshot(latestRef, async (msgSnap) => {
              if (msgSnap.empty) return;
              const m: any = msgSnap.docs[0].data();
              if (!m?.timestamp) return;
              // Initialize lastNotified on first snapshot to prevent retroactive alerts
              if (!lastNotified.has(chatId)) {
                lastNotified.set(chatId, m.timestamp);
                return;
              }
              const prev = lastNotified.get(chatId) ?? 0;
              if (m.timestamp <= prev) return;
              lastNotified.set(chatId, m.timestamp);
              if (m.senderId === u.uid) return;

              // Build title from chat data
              let title = 'New message';
              const chatData: any = (await getDoc(doc(db, 'chats', chatId))).data() || {};
              let avatar: string | null = null;
              if (chatData?.type === 'group' && chatData?.groupName) {
                title = chatData.groupName;
              } else {
                // direct chat: get sender profile for name/avatar
                const senderSnap = await getDoc(doc(db, 'users', m.senderId));
                const sp = senderSnap.data() as any;
                title = sp?.displayName || 'New message';
                avatar = sp?.photoURL || null;
              }
              const body = m.text ? String(m.text) : 'Sent a photo';
              const { showLocalNotification } = await import('./lib/notifications');
              showLocalNotification(title, body, { chatId }, avatar);
            });
            perChatSubs.set(chatId, unsubLatest);
          });

          // Remove listeners for chats no longer present
          for (const [chatId, unsub] of Array.from(perChatSubs.entries())) {
            if (!currentIds.has(chatId)) {
              unsub();
              perChatSubs.delete(chatId);
              lastNotified.delete(chatId);
            }
          }
        });
        // Store cleanup on window for this session
        (global as any).__chatUnsubs && (global as any).__chatUnsubs();
        (global as any).__chatUnsubs = () => {
          unsubChats();
          for (const [, unsub] of perChatSubs) unsub();
          perChatSubs.clear();
          lastNotified.clear();
        };
      } else {
        setNeedsOnboarding(false);
        (global as any).__chatUnsubs && (global as any).__chatUnsubs();
      }
      setReady(true);
    });
    return () => unsub();
  }, []);

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
        <AppNavigator />
      )}
    </NavigationContainer>
  );
}
