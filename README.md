# WhatsApp-style Chat (Expo + Firebase)

A cross-platform chat app built with Expo (React Native) and Firebase. Supports email auth, friends with requests, direct/group chats, optimistic messaging with offline outbox, realtime presence, unread divider, and foreground notifications.

## 1) Prerequisites
- macOS with Xcode (for iOS Simulator)
- Node 20.x and npm 10.x
- Git + a GitHub repo (already configured)
- Expo CLI (via npx expo)

Optional (recommended later):
- EAS CLI for Dev Client / cloud builds

## 2) Install
```bash
cd app
npm install
```

## 3) Configure Firebase
1. Create a Firebase project (or use existing). Note your `projectId`.
2. Project settings → Your apps → Add app → Web. Copy the config values.
3. Create `.env` in `app/` with EXPO_PUBLIC_ vars:
```bash
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
```
The app loads these via `app.config.ts`.

### Firestore structure
- `users/{uid}`: displayName, photoURL, emailLower, statusMessage, online/status/lastSeen (written by app), pushTokens[]
- `friendRequests/{id}`: fromUid, toUid, status, createdAt
- `friends/{uid}/list/{friendUid}`: friendUid, addedAt
- `chats/{chatId}`: type, members[], groupName/photo, lastMessage/lastMessageAt, readStatus{uid:lastReadAt}
- `chats/{chatId}/messages/{messageId}`: senderId, text/imageUrl, timestamp
- `presence/{uid}`: online, state, lastChanged (written by app)

## 4) Run the app
Prefer Expo Go for quick start; Dev Client for richer native features (notifications etc.).

### Expo Go (quickest)
```bash
cd app
npx expo start -c
# press i to open iOS Simulator (or open Expo Go app on device)
```
If the CLI insists on a dev build, press `s` to switch to Expo Go.

### Dev Client (optional)
Use when you need full `expo-notifications` support.
```bash
cd app
npx expo prebuild -p ios
npx expo run:ios
# in another terminal
npx expo start --dev-client
```

## 5) Features and behaviors
- Auth: Email/password (Google later). Auth persistence warning is expected for now (we didn’t wire AsyncStorage yet).
- Friends: Incoming/outgoing requests and friends list update in real time; tap friend to open a direct chat.
- Presence: On login + every 10s while active, app writes `presence/{uid}` and `users/{uid}` (online/status/lastSeen). Friends screen subscribes and shows a live green dot when online.
- Chats list: All chats where you are a member, sorted by `lastMessageAt`.
- Messaging:
  - Optimistic UI: Messages render immediately with a "sending…" indicator.
  - Offline outbox: Failed sends are queued and auto-retried every 1s; also flushed when app returns to foreground.
  - Pagination: Loads latest 10; scroll up to fetch older messages in batches of 10.
  - Unread divider: Inserts a "New messages" banner at the first unread message on entry and scrolls near it.
  - Read state: Per-user `readStatus` (derived unread count next to own messages).
- Notifications (foreground): Global listener per chat; shows a banner for new incoming messages while app is foregrounded.
  - Expo Go has limitations; use a Dev Client for richer behavior when needed.

## 6) Multi-device testing
- iOS: open a second simulator
```bash
open -na Simulator
```
Open Expo Go in each simulator and load the same project URL (use Tunnel if LAN fails). Sign in as different users.

## 7) Troubleshooting
- Port in use / stuck server:
```bash
pkill -f "expo start" || true
lsof -ti tcp:8081,19000,19001,19002 | xargs kill -9 || true
```
- Clear cache / restart:
```bash
npx expo start -c
```
- Dev build prompt while you want Expo Go: press `s` to switch to Expo Go.
- Check logs (Metro): the terminal running `npx expo start`. DevTools: press `d`.
- Verify Firebase project in app logs:
  - Metro should show: `Firebase projectId <yourId>` at startup.
- Presence not turning green:
  - Ensure each user opened the app (Friends tab triggers a presence write).
  - Confirm `presence/{uid}` and `users/{uid}` fields update.
- Notifications not appearing in Expo Go:
  - Known limitation; use Dev Client for full support.

## 8) Known gaps / TODOs
- Google OAuth
- Firestore offline persistence config (IndexedDB on web / persistence for RN)
- ESLint + Prettier baseline
- Branding assets (icon/splash) and theme
- Background push (requires Dev Client + APNs)

## 9) Scripts
Common commands:
```bash
# Start (Expo Go)
cd app && npx expo start -c

# Start on a port
npx expo start -c --port 8090

# iOS simulator
press i in the Expo CLI, or: open -a Simulator
```

## 10) Security notes
- Start with permissive Firestore rules for MVP/testing; harden later.
- Always review rules before distributing builds.

---
If you run into issues, check the Metro logs first, then confirm your Firebase `projectId` matches the console you’re viewing.

