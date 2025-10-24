# Active Context — TripMate AI v2 Decisions

Last Updated: 2025-10-23

## Scope
Integrate TripMate AI into this repo alongside the existing Expo client.

## Repository Layout
- app/ — Expo client
- app/api/ — Vercel Serverless (Node) API for TripMate AI
- app/shared/ — Shared TypeScript types, zod schemas, API contracts

## Security & Auth
- Client sends Firebase ID token on every request (Authorization: Bearer <token>)
- API verifies token with Firebase Admin and authorizes that uid ∈ chats/{chatId}.members
- Server credentials (Vercel env): FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (\n escaped)

## AI Contracts
- Draft endpoint: POST /api/ai/draft { chatId, tool, payload? } → returns draft only
- Share endpoint: POST /api/ai/share { chatId, tool, draft } → persists result
- No writes on Discard

## Data Shapes
- Chat messages include: type: 'text' | 'ai_response' | 'poll' | 'reminder', visibility: 'shared', relatedFeature
- Polls: one vote per user (map keyed by uid), revote allowed (overwrite)
- Reminders: status transitions scheduled → notified → completed/expired; TTL/purge based on dueAt
- Trips: single tripId per chat

## Retrieval & Models
- RAG window: last 200 messages; exclude images/AI/system messages
- Model: OpenAI GPT‑4.1; plain text output (no markdown for MVP)
- Weather: OpenWeatherMap; units = imperial; horizon = trip duration

## UX Triggers
- Long‑press message actions and a composer “+” action feed into the same AI tools
- AI Preview Modal → Share or Discard

## Non‑Goals / Constraints (for now)
- Keep all v1 behaviors (presence, unread banner, pagination, notifications)
- Group size target ≈ 20
- No feature flag for AI at this time
