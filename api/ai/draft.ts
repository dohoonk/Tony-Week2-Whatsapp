// Plain Node-style handler without Next.js types to avoid type deps on Vercel

// Inline Firebase Admin bootstrap (avoid external imports)
let admin: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  admin = require('firebase-admin');
} catch {}
let __adminApp: any = null;
function getAdminApp() {
  if (__adminApp) return __adminApp;
  if (!admin) throw new Error('firebase-admin not installed');
  const projectId = process.env.FIREBASE_PROJECT_ID as string;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL as string;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY as string;
  const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, '\n') : undefined;
  if (!projectId || !clientEmail || !privateKey) throw new Error('Missing Firebase Admin credentials');
  __adminApp = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
  return __adminApp;
}
function getAdminDb() {
  return getAdminApp().firestore();
}
async function verifyIdToken(idToken: string) {
  const auth = getAdminApp().auth();
  return await auth.verifyIdToken(idToken);
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const auth = req.headers?.authorization || '';
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) { res.status(401).json({ error: 'Missing Authorization header' }); return; }

    const decoded = await verifyIdToken(token);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { chatId, tool } = body as any;
    if (!chatId || !tool) { res.status(400).json({ error: 'chatId and tool are required' }); return; }

    const db = getAdminDb();
    const snap = await db.collection('chats').doc(chatId).get();
    if (!snap.exists) { res.status(404).json({ error: 'Chat not found' }); return; }
    const members: string[] = Array.isArray((snap.data() as any)?.members) ? (snap.data() as any).members : [];
    if (!members.includes(decoded.uid)) { res.status(403).json({ error: 'Forbidden' }); return; }
    // RAG: last 200 text messages (exclude images/AI/system)
    const msgsSnap = await db.collection('chats').doc(chatId).collection('messages')
      .orderBy('timestamp', 'desc').limit(250).get();
    const messages = msgsSnap.docs
      .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
      .filter((m: any) => !m.imageUrl && m.type !== 'ai_response' && m.type !== 'system')
      .slice(0, 200)
      .reverse();

    let draftText = `[DRAFT:${tool}] placeholder`;
    const openaiKey = process.env.OPENAI_API_KEY as string | undefined;
    if (openaiKey) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { OpenAI } = require('openai');
        const client = new OpenAI({ apiKey: openaiKey });
        const context = messages.map((m: any) => `- ${m.senderId === 'ai' ? 'AI' : m.senderId}: ${m.text || ''}`).join('\n');
        let prompt = '';
        if (tool === 'summarize') {
          prompt = `Summarize this group chat succinctly for all members. Plain text only.\n\nChat (latest last):\n${context}`;
        } else if (tool === 'poll') {
          prompt = `You are drafting a group poll based on the conversation. Use only plain text.\nFormat exactly:\nQuestion: <one concise question>\nOptions:\n- <option 1>\n- <option 2>\n- <option 3>\n- <option 4 (optional)>\n- <option 5 (optional)>\nKeep options mutually exclusive and short.\n\nChat (latest last):\n${context}`;
        } else if (tool === 'poll_summary') {
          const p = (body as any)?.poll;
          const q = p?.question || '';
          const opts: string[] = Array.isArray(p?.options) ? p.options : [];
          const counts: number[] = Array.isArray(p?.counts) ? p.counts : [];
          const lines = opts.map((o, i) => `- ${o}: ${counts[i] ?? 0}`).join('\\n');
          prompt = `Summarize poll results in a single plain-text sentence (no markdown).\nQuestion: ${q}\nResults:\n${lines}`;
        } else if (tool === 'reminder') {
          prompt = `Draft a one-line reminder in plain text based on the conversation (no dates parsing yet).\nExample: "Reminder: Pay the Airbnb by Friday."\n\nChat (latest last):\n${context}`;
        } else if (tool === 'trip') {
          prompt = `Draft a short plain-text suggestion for next steps in trip planning (no markdown).\n\nChat (latest last):\n${context}`;
        } else if (tool === 'weather') {
          // Try to extract a simple location from recent conversation
          const locMatch = /\b(in|at|to)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\b/.exec(context);
          const city = (locMatch?.[2] || '').trim();
          const owmKey = process.env.OWM_API_KEY as string | undefined;
          let summary = '';
          if (owmKey && city) {
            try {
              // 5-day / 3h forecast, imperial units
              const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${owmKey}&units=imperial`;
              const resp = await fetch(url);
              if (resp.ok) {
                const data: any = await resp.json();
                const list: any[] = Array.isArray(data?.list) ? data.list : [];
                // Aggregate by date
                const byDay: Record<string, { hi: number; lo: number; conditions: Record<string, number> }> = {};
                for (const it of list) {
                  const ts = (it?.dt ?? 0) * 1000;
                  const d = new Date(ts);
                  const dayKey = d.toISOString().slice(0, 10);
                  const temp: number = it?.main?.temp ?? 0;
                  const cond: string = ((it?.weather?.[0]?.main as string) || 'Unknown');
                  if (!byDay[dayKey]) byDay[dayKey] = { hi: -Infinity, lo: Infinity, conditions: {} };
                  byDay[dayKey].hi = Math.max(byDay[dayKey].hi, temp);
                  byDay[dayKey].lo = Math.min(byDay[dayKey].lo, temp);
                  byDay[dayKey].conditions[cond] = (byDay[dayKey].conditions[cond] || 0) + 1;
                }
                const days = Object.keys(byDay).slice(0, 5);
                const parts = days.map((dk) => {
                  const d = byDay[dk];
                  const topCond = Object.entries(d.conditions).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] ?? '—';
                  return `${dk}: ${Math.round(d.lo)}°F–${Math.round(d.hi)}°F, ${topCond}`;
                });
                summary = `Weather for ${city} (next ${parts.length} days)\n` + parts.join('\n');
              }
            } catch {}
          }
          if (!summary) {
            summary = city
              ? `Weather summary is unavailable right now for ${city}.`
              : 'Weather summary unavailable: specify a city (e.g., “Weather in Denver”).';
          }
          // Hand the already summarized plain text back
          prompt = `Return this text as-is (no formatting changes): ${summary}`;
        } else {
          prompt = `Create a helpful plain-text draft for tool: ${tool}. Use the conversation as context.\n\nChat (latest last):\n${context}`;
        }
        const resp = await client.responses.create({ model: 'gpt-4.1-mini', input: prompt });
        const out = (resp as any)?.output_text || '';
        if (out) draftText = out;
      } catch {}
    }

    res.status(200).json({ draft: { text: draftText }, meta: { tool, chatId } });
  } catch (e: any) {
    const hasProject = !!process.env.FIREBASE_PROJECT_ID;
    const hasEmail = !!process.env.FIREBASE_CLIENT_EMAIL;
    const hasKey = !!process.env.FIREBASE_PRIVATE_KEY;
    res.status(500).json({ error: e?.message || 'Server error', env: { hasProject, hasEmail, hasKey } });
  }
}


