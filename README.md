# WhatsApp-style Chat (Expo + Firebase)

## 👥 Persona: “The Trip Crew”
Digital-native groups of 4–6 friends planning weekend trips and events entirely in chat. They want decisions, reminders, itineraries, and weather handled in the same place they talk.

Key needs:
- Reduce planning chaos with quick summaries and clear next steps
- Lightweight polls for fast consensus
- Deadlines with shared reminders
- AI-generated itineraries
- Weather-aware plans across the trip window

A cross-platform chat app built with Expo (React Native) and Firebase. Supports email auth, friends with requests, direct/group chats, optimistic messaging with offline outbox, realtime presence, unread divider, and foreground notifications.

## Monorepo Layout
```
root/
  app/            # Expo client (this README)
  app/api/        # Vercel Serverless (Node runtime)
  app/shared/     # Shared types
```

## Architecture overview

Client (Expo React Native)
- Firebase Auth (email, Google); presence writes on login/foreground
- Firestore for users, chats, messages, polls, reminders, trips
- Storage for image messages/avatars
- NetInfo for connectivity; optimistic UI with offline outbox; foreground notifications
- Trip Planner: itinerary editing, weather refresh, and share-to-chat

Server (Vercel Serverless, Node runtime)
- Verifies Firebase ID token via Admin SDK on every request and authorizes chat membership
- Endpoints: `/api/ai/draft`, `/api/ai/share`, `/api/tools/tripWeather`
- Integrations: OpenAI GPT‑4.1 (generation + extractors), WeatherAPI.com (forecast)
- Writes privileged updates (trips/polls/reminders) to Firestore

RAG flow (TripMate AI)
1) Retrieve last 200 text messages (exclude images/AI/system)
2) Summarize context when needed (e.g., trip) to a compact planning summary
3) Intent extraction returns strict JSON (city, dates, poll options, etc.)
4) Call deterministic tools/APIs (e.g., WeatherAPI); normalize dates
5) Return a draft to the client; Share persists; Discard leaves no trace

## Architecture diagrams

High-level components
```mermaid
flowchart LR
  RN[Expo React Native App — Chats & Trip Planner] -- Firebase ID token --> API[Vercel Serverless API]
  RN -- Firestore SDK --> FS[(Firestore)]
  RN -- Storage SDK --> ST[(Firebase Storage)]
  API -- Admin SDK (verify, reads/writes) --> FS
  API -- OpenAI GPT-4.1 --> LLM[(OpenAI)]
  API -- WeatherAPI.com --> WX[(Weather)]
```

AI draft/share sequence
```mermaid
sequenceDiagram
  participant U as User
  participant RN as Expo App
  participant API as Vercel API
  participant FB as Firebase Admin/Firestore
  participant LLM as OpenAI
  participant WX as WeatherAPI
  U->>RN: Long-press → TripMate AI
  RN->>API: POST /api/ai/draft (Bearer ID token)
  API->>FB: Verify token + membership
  API->>FB: Fetch last 200 messages (RAG)
  API->>LLM: Summarize / extract intent (strict JSON)
  API->>WX: (if weather) segment forecast
  API-->>RN: Draft text (plain)
  U->>RN: Share
  RN->>API: POST /api/ai/share (tool, draft)
  API->>FB: Write trip/poll/reminder + ai_response
```

## Code conventions

- Files/structure: feature-oriented; screens under `app/screens/*`, shared UI under `app/components/*`, libs under `app/lib/*`
- Naming: components PascalCase, hooks/use* camelCase, types PascalCase, constants UPPER_SNAKE
- TypeScript: prefer explicit types on exports/public APIs; avoid `any`; narrow with guards
- Comments: only for non-obvious rationale, invariants, security/perf caveats; avoid noise
- UI: consistent primitives (`AppButton`, `AppCard`, `AppText`, `FormField`, `Banner`); theme-aware colors; dark mode
- Network/API: every server call includes Firebase ID token; server re-verifies and checks membership

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

### Serverless (Vercel) env vars
Set these in Vercel → Project → Settings → Environment Variables:
```
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
OPENAI_API_KEY=...
WEATHERAPI_KEY=...
```
Client also needs the API base URL:
```
EXPO_PUBLIC_AI_API_URL=https://<your-vercel-domain>
```

### Firestore structure
- `users/{uid}`: displayName, photoURL, emailLower, statusMessage, online/status/lastSeen (written by app), pushTokens[]
- `friendRequests/{id}`: fromUid, toUid, status, createdAt
- `friends/{uid}/list/{friendUid}`: friendUid, addedAt
- `chats/{chatId}`: type, members[], groupName/photo, lastMessage/lastMessageAt, readStatus{uid:{id,at}}, tripId?, pollId?, reminderId?
- `chats/{chatId}/messages/{messageId}`: senderId, text/imageUrl, timestamp
- `presence/{uid}`: online, state, lastChanged (written by app)
- `polls/{pollId}`: question, options[], votes{uid:index}, status, resultPosted
- `reminders/{reminderId}`: chatId, title, dueAt, status
- `trips/{chatId}`: title, destination, startDate, endDate, notes, members[], version, itinerary[], archived

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
  - For the demo we gate notifications to Expo Go; Dev Client recommended for full support.

### TripMate AI (v2)
- Long‑press a message or tap the composer `+` to open AI tools: summarize, create poll, add reminder, plan trip, weather.
- Type `@TM <question>` in the composer to ask TripMate directly (e.g., `@TM what's the weather in Seattle next week?`).
  - The server supports `tool="auto"` with LLM intent extraction (strict JSON). We validate and then call deterministic tools/APIs.
- RAG window: last 200 text messages (images/AI/system excluded).
- Drafts are private until you tap Share (no writes on Discard).
- Weather uses WeatherAPI (imperial units) and now shows the resolved city name alongside daily temps and icons.

### Trips, Polls, Reminders
- Trips: single `trips/{chatId}` doc with versioning; itinerary editing and posting to chat.
- Itinerary editor: per‑day City field; city precedence is day.city → carry‑forward → title city. Weather requests are year‑normalized (no historical fetches). Server returns resolved city with lat/lon and the client writes it to each day as `resolved`.
- See itinerary model and flow in `../itinerary.md`.
- Polls: one vote per user, revotes allowed; auto-close and single summary message.
- Reminders: scheduled → notified → completed/expired, with foreground notifications to members.

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
  - Known limitation; use Dev Client for full support. In this repo we also show an in‑app banner in foreground.

### AI Debugging
- Weather path logs (server): intent JSON from LLM, parsed city/date range, WeatherAPI search/forecast URLs (redacted key), and result count.
- Set `EXPO_PUBLIC_AI_API_URL` correctly; verify Firebase Admin creds on Vercel.

## 8) Scripts
Common commands:
```bash
# Start (Expo Go)
cd app && npx expo start -c

# Start on a port
npx expo start -c --port 8090

# iOS simulator
press i in the Expo CLI, or: open -a Simulator
```

## 9) Security notes
- Start with permissive Firestore rules for MVP/testing; harden later.
- Always review rules before distributing builds.

---
If you run into issues, check the Metro logs first, then confirm your Firebase `projectId` matches the console you’re viewing.

