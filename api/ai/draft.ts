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
    // Weather summary (WeatherAPI) computed first; if available, we short‑circuit and return it
    let weatherSummary: string | null = null;
    if (tool === 'weather') {
      try {
        const contextStr = messages.map((m: any) => m.text || '').join(' ');
        const locMatch = /\b(?:weather\s+(?:in|at|for)\s+|(?:in|at|to)\s+)([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\b/i.exec(contextStr);
        const city = (locMatch?.[1] || '').trim();

        // Parse date range: supports YYYY-MM-DD, M/D/YYYY, and "November 2" forms
        const isoDates = Array.from(contextStr.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)).map(m => m[0]);
        const slashDates = Array.from(contextStr.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)).map(m => {
          const y = m[3].length === 2 ? `20${m[3]}` : m[3];
          const mm = String(m[1]).padStart(2, '0');
          const dd = String(m[2]).padStart(2, '0');
          return `${y}-${mm}-${dd}`;
        });
        const monthNames = '(January|February|March|April|May|June|July|August|September|October|November|December)';
        const monthDates = Array.from(contextStr.matchAll(new RegExp(`\b${monthNames}\\s+(\d{1,2})(?:,\\s*(\d{4}))?`, 'gi'))).map(m => {
          const monthIndex = [
            'january','february','march','april','may','june','july','august','september','october','november','december'
          ].indexOf(m[1].toLowerCase());
          const year = m[2] ? parseInt(m[2], 10) : (new Date()).getFullYear();
          const mm = String(monthIndex + 1).padStart(2, '0');
          const dd = String(parseInt(m[2] ? m[3] : m[2] || m[2], 10) || parseInt(m[2]||'0', 10)).padStart(2,'0');
          // m indices are messy above; recompute from regex groups safely
          const day = String(parseInt(m[2] ? m[2] : m[2] || '0', 10));
          const dd2 = String(parseInt(m[2] ? m[2] : (m[2] as any) || '0', 10));
          const dInt = parseInt(m[2] as any, 10);
          const dayNum = isNaN(dInt) ? parseInt(m[2] as any, 10) : dInt;
          const ddFinal = String(dayNum).padStart(2, '0');
          return `${year}-${mm}-${ddFinal}`;
        }).filter(Boolean);

        // Consolidate and sort unique dates
        let dates: string[] = Array.from(new Set([...isoDates, ...slashDates, ...monthDates]));
        dates.sort();
        if (dates.length === 1) dates = [dates[0], dates[0]]; // single date → same start/end

        const wxKey = process.env.WEATHERAPI_KEY as string | undefined;
        if (wxKey && city) {
          const today = new Date();
          const toISO = (d: Date) => d.toISOString().slice(0,10);
          const start = dates[0] || toISO(today);
          const end = dates[1] || start;
          const dayDiff = (Date.parse(end) - Date.parse(start)) / (24*3600*1000);

          const results: { date: string; lo: number; hi: number; cond: string }[] = [];
          const within14 = (Date.parse(start) - Date.now())/(24*3600*1000) <= 14 && (Date.parse(end) - Date.now())/(24*3600*1000) <= 14;
          if (within14) {
            // Use forecast.json up to 14 days
            const daysNeeded = Math.min(14, Math.max(1, Math.ceil((Date.parse(end) - Date.now())/(24*3600*1000)) + 1));
            const url = `https://api.weatherapi.com/v1/forecast.json?key=${wxKey}&q=${encodeURIComponent(city)}&days=${daysNeeded}&aqi=no&alerts=no`;
            const resp = await fetch(url);
            if (resp.ok) {
              const data: any = await resp.json();
              const fdays: any[] = Array.isArray(data?.forecast?.forecastday) ? data.forecast.forecastday : [];
              for (const d of fdays) {
                const dateStr = d?.date as string;
                if (dateStr >= start && dateStr <= end) {
                  results.push({ date: dateStr, lo: Math.round(d?.day?.mintemp_f ?? 0), hi: Math.round(d?.day?.maxtemp_f ?? 0), cond: (d?.day?.condition?.text as string) || '—' });
                }
              }
            }
          } else {
            // Use future.json per date (up to 365 days)
            const dateList: string[] = [];
            for (let t = Date.parse(start); t <= Date.parse(end); t += 24*3600*1000) {
              dateList.push(new Date(t).toISOString().slice(0,10));
            }
            for (const dt of dateList) {
              const url = `https://api.weatherapi.com/v1/future.json?key=${wxKey}&q=${encodeURIComponent(city)}&dt=${dt}`;
              const resp = await fetch(url);
              if (resp.ok) {
                const data: any = await resp.json();
                const day = data?.forecast?.forecastday?.[0]?.day;
                if (day) {
                  results.push({ date: dt, lo: Math.round(day?.mintemp_f ?? 0), hi: Math.round(day?.maxtemp_f ?? 0), cond: (day?.condition?.text as string) || '—' });
                }
              }
            }
          }
          if (results.length > 0) {
            const parts = results.map(r => `${r.date}: ${r.lo}°F–${r.hi}°F, ${r.cond}`);
            weatherSummary = `Weather for ${city} (${start} → ${end})\n` + parts.join('\n');
          }
        }
        if (!weatherSummary) {
          weatherSummary = city
            ? `Weather summary is unavailable right now for ${city}.`
            : 'Weather summary unavailable: specify a city (e.g., “Weather in Denver”).';
        }
      } catch {}
    }

    const openaiKey = process.env.OPENAI_API_KEY as string | undefined;
    if (tool === 'weather' && weatherSummary) {
      draftText = weatherSummary;
    } else if (openaiKey) {
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
          // Fallback: if we couldn't compute a summary above and no API key, return guidance
          prompt = `Return this text as-is (no formatting): Weather summary unavailable.`;
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


