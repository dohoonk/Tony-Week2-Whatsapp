# TripMate AI API

Serverless API (Vercel, Node runtime) for TripMate AI. Verifies Firebase ID tokens, authorizes chat membership, fetches context, and returns AI drafts or writes shared outputs.

## Env (Vercel)
- FIREBASE_PROJECT_ID
- FIREBASE_CLIENT_EMAIL
- FIREBASE_PRIVATE_KEY (escape newlines as \n)
- OPENAI_API_KEY (later)
- OWM_API_KEY (later)

## Dev
```
npm install
npm run dev
```

## Deployment (Vercel)
1) Set env vars in Vercel project (Settings → Environment Variables):
   - FIREBASE_PROJECT_ID
   - FIREBASE_CLIENT_EMAIL
   - FIREBASE_PRIVATE_KEY (paste with \n escapes)
   - OPENAI_API_KEY (later)
   - OWM_API_KEY (later)
2) Deploy via Vercel UI or CLI.
3) In the Expo app, set `EXPO_PUBLIC_AI_API_URL` to the Vercel deployment URL.


