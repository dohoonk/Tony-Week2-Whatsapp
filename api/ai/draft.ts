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
    const { chatId, tool, prompt } = body as any;
    if (tool === 'weather' || tool === 'auto') {
      try { console.log('[WX] received', { tool, chatId }); } catch {}
    }
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
    let resolvedTool: string = tool;
    let itineraryOut: Array<{ date: string; items: string[] }> | null = null;
    // Weather summary (WeatherAPI) computed first; if available, we short‑circuit and return it
    let weatherSummary: string | null = null;
    if (tool === 'auto') {
      try {
        const openaiKey = process.env.OPENAI_API_KEY as string | undefined;
        if (openaiKey) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { OpenAI } = require('openai');
          const client = new OpenAI({ apiKey: openaiKey });
          const context = messages.map((m: any) => `- ${m.senderId === 'ai' ? 'AI' : m.senderId}: ${m.text || ''}`).join('\n');
          const basePrompt = `Extract user intent and structured fields from the following prompt and chat context. Return ONLY compact JSON (no code fences, no commentary) matching this schema:
{
  "intent": "weather|summarize|poll|reminder|trip|general",
  "city": "optional string",
  "start": "YYYY-MM-DD optional",
  "end": "YYYY-MM-DD optional",
  "question": "optional string",
  "options": ["opt1","opt2","opt3"]
}
Rules:
- If prompt says "next week", compute concrete start/end (7-day window starting in 7 days, user's local time ok).
- City must be a place name (prefer city over airport); include only the city name.
- For polls, extract 2-5 concise options if present.
Prompt: ${String(prompt || '')}
Chat (latest last):\n${context}`;
          const resp = await client.responses.create({ model: 'gpt-4.1-mini', input: basePrompt });
          const out = (resp as any)?.output_text || '';
          let parsed: any = null;
          try { parsed = JSON.parse(out); } catch {}
          // debug removed
          if (parsed && typeof parsed === 'object' && typeof parsed.intent === 'string') {
            const intent = String(parsed.intent).toLowerCase();
            if (intent === 'weather') {
              resolvedTool = 'weather';
              // reuse weather branch below with parsed city/start/end
              (body as any).__parsed = { city: parsed.city, start: parsed.start, end: parsed.end };
            } else if (intent === 'summarize') {
              resolvedTool = 'summarize';
            } else if (intent === 'poll') {
              resolvedTool = 'poll';
              (body as any).__poll = { question: parsed.question, options: Array.isArray(parsed.options) ? parsed.options : [] };
            } else if (intent === 'reminder') {
              resolvedTool = 'reminder';
            } else if (intent === 'trip') {
              resolvedTool = 'trip';
            } else {
              resolvedTool = 'general';
            }
          }
        }
      } catch {}
    }

    if (tool === 'weather' || resolvedTool === 'weather') {
      try {
        const wxKey = process.env.WEATHERAPI_KEY as string | undefined;

        // Helper: normalize dates found in the text to ISO (YYYY-MM-DD)
        const toISODates = (text: string): string[] => {
          const out: string[] = [];
          // ISO
          const iso = Array.from(text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g));
          iso.forEach((m: any) => out.push(m[0]));
          // Slash
          const slash = Array.from(text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g));
          slash.forEach((m: any) => {
            const y = (m[3].length === 2 ? `20${m[3]}` : m[3]);
            const mm = String(parseInt(m[1], 10)).padStart(2, '0');
            const dd = String(parseInt(m[2], 10)).padStart(2, '0');
            out.push(`${y}-${mm}-${dd}`);
          });
          // Month names
          const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
          const monthRe = new RegExp(`\\b(${months.join('|')})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?`, 'gi');
          let mmatch: RegExpExecArray | null;
          while ((mmatch = monthRe.exec(text)) !== null) {
            const idx = months.indexOf(mmatch[1].toLowerCase());
            const year = mmatch[3] ? parseInt(mmatch[3], 10) : (new Date()).getFullYear();
            const mm = String(idx + 1).padStart(2, '0');
            const dd = String(parseInt(mmatch[2], 10)).padStart(2, '0');
            out.push(`${year}-${mm}-${dd}`);
          }
          return out;
        };

        // ALWAYS ask LLM to extract a city and dates for weather
        try {
          const openaiKeyWx = process.env.OPENAI_API_KEY as string | undefined;
          if (openaiKeyWx) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { OpenAI } = require('openai');
            const client = new OpenAI({ apiKey: openaiKeyWx });
            const context = messages.map((m: any) => `- ${m.senderId === 'ai' ? 'AI' : m.senderId}: ${m.text || ''}`).join('\n');
            const extractor = `Extract a single best city and a concrete start/end date for a weather query.
Return ONLY JSON (no markdown): { "city": string, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }
Rules: City must be a real city/town (avoid airports); title-case; min 3 chars; reject stopwords like "we".
Resolve phrases like "next week"/"this weekend" to ISO dates.
Prompt: ${String(prompt || '')}
Chat (latest last):\n${context}`;
            try { console.log('[WX] extractorPrompt', extractor); } catch {}
            const resp = await client.responses.create({ model: 'gpt-4.1-mini', input: extractor, response_format: { type: 'json_object' } });
            const out = (resp as any)?.output_text || '';
            // debug removed
            let parsed: any = null;
            try { parsed = JSON.parse(out); } catch {}
            try { console.log('[WX] extractorParsed', parsed); } catch {}
            if (parsed && typeof parsed === 'object') {
              const pCity = String(parsed.city || '').trim();
              const pStart = String(parsed.start || '').trim();
              const pEnd = String(parsed.end || '').trim();
              if (pCity && pCity.length >= 3 && !/^we$/i.test(pCity)) {
                (body as any).__parsed = { city: pCity, start: pStart, end: pEnd };
              }
            }
          }
        } catch {}

        // Extract potential city phrase with tolerant patterns and trim at delimiters
        let cityPhrase = '';
        const cleaned = [
          typeof prompt === 'string' ? prompt : '',
          ...messages.map((m: any) => String(m.text || '')),
        ].join(' ').replace(/[“”"']/g, '');
        // If LLM provided parsed city/start/end, use those first
        cityPhrase = String((body as any)?.__parsed?.city || cityPhrase || '').trim();
        let parsedStart = String((body as any)?.__parsed?.start || '').trim();
        let parsedEnd = String((body as any)?.__parsed?.end || '').trim();
        // debug removed

        const USE_REGEX = false; // disable regex-based city parsing
        // 1) Allow words between 'weather' and preposition
        const p1 = !cityPhrase && USE_REGEX ? /weather[\w\s,.-]{0,80}?(?:in|at|for)\s+([A-Za-z][A-Za-z\s-]{1,40})/i.exec(cleaned) : null;
        if (!cityPhrase && p1) cityPhrase = (p1[1] || '').trim();
        // 2) Fallback: any 'in|at|for <city>' anywhere (case-insensitive, allow lowercase)
        if (!cityPhrase && USE_REGEX) {
          const p2 = /\b(?:in|at|for)\s+([A-Za-z][A-Za-z\s-]{1,40})(?=\s+(?:next|this|coming|week(?:end)?|today|tomorrow|tonight|from|to|on|by)|[?.!,]|$)/i.exec(cleaned);
          if (p2) cityPhrase = (p2[1] || '').trim();
        }
        // Cleanup trailing date/time words
        if (cityPhrase) {
          cityPhrase = cityPhrase.replace(/\b(next|this|coming|weekend|week|today|tomorrow|tonight|from|to|on|by)\b.*$/i, '').trim();
          cityPhrase = cityPhrase.replace(/\s+-\s+.*$/, '').trim();
        }
        // Title-case the phrase for nicer matching
        if (cityPhrase) {
          cityPhrase = cityPhrase
            .split(/\s+/)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
        }
        // Reject obvious non-city phrases
        if (/chat|thread|message/i.test(cityPhrase)) cityPhrase = '';
        if (cityPhrase && /[^A-Za-z\s]/.test(cityPhrase)) cityPhrase = '';
        // debug removed

        const allDates = (parsedStart && parsedEnd) ? [parsedStart, parsedEnd] : toISODates(cleaned).sort();
        const today = new Date();
        const toISO = (d: Date) => d.toISOString().slice(0,10);
        let start = allDates[0] || toISO(today);
        let end = allDates[1] || start;
        // Relative ranges: "next week" => seven-day window starting in 7 days
        if (!parsedStart && /\bnext\s+week\b/i.test(cleaned)) {
          const s = new Date(); s.setDate(s.getDate() + 7); s.setHours(0,0,0,0);
          const e = new Date(s); e.setDate(e.getDate() + 6);
          start = toISO(s); end = toISO(e);
        }
        if (!parsedStart && (/\bthis\s+weekend\b/i.test(cleaned) || /\bnext\s+weekend\b/i.test(cleaned))) {
          const base = new Date();
          const add = /\bnext\s+weekend\b/i.test(cleaned) ? 7 : 0;
          const s = new Date(base); s.setDate(s.getDate() + ((6 - s.getDay() + 7) % 7) + add); s.setHours(0,0,0,0); // Saturday
          const e = new Date(s); e.setDate(e.getDate() + 1); // Sunday
          start = toISO(s); end = toISO(e);
        }
        // debug removed

        // If we have LLM-parsed values, prefer those
        const segCity = String((body as any)?.__parsed?.city || cityPhrase || '').trim();
        const segStart = String((body as any)?.__parsed?.start || start || '').trim();
        const segEnd = String((body as any)?.__parsed?.end || end || segStart || '').trim();
        const pathUsed = (body as any)?.__parsed?.city ? 'llm' : (cityPhrase ? 'regex' : 'none');
        try { console.log('[WX] path', { pathUsed, segCity, segStart, segEnd }); } catch {}

        if (wxKey && segCity) {
          // Validate/resolve city via WeatherAPI search, use lat,lon for certainty
          let resolved: { name: string; lat: number; lon: number; country: string } | null = null;
          try {
            const sUrl = `https://api.weatherapi.com/v1/search.json?key=${wxKey}&q=${encodeURIComponent(segCity)}`;
            try { console.log('[WX] search', { url: sUrl.replace(/key=[^&]+/, 'key=***'), q: segCity }); } catch {}
            const sResp = await fetch(sUrl);
            if (sResp.ok) {
              const arr: any[] = await sResp.json();
              if (Array.isArray(arr) && arr.length > 0) {
                // Prefer non-airport results that include the requested city
                const filtered = arr.filter((x: any) => !/airport|air base|aerodrome/i.test(String(x?.name || '')));
                const exact = filtered.find((x: any) => String(x?.name || '').toLowerCase() === segCity.toLowerCase());
                const partial = filtered.find((x: any) => String(x?.name || '').toLowerCase().includes(segCity.toLowerCase()));
                // If both city and region provided (e.g., "Austin, TX") try exact composite match
                let top = exact || partial || filtered[0] || arr[0];
                if (!exact && /,/.test(segCity)) {
                  const parts = segCity.split(',').map(s => s.trim().toLowerCase());
                  const composite = filtered.find((x: any) => {
                    const name = String(x?.name || '').toLowerCase();
                    const region = String(x?.region || '').toLowerCase();
                    return name === parts[0] && (region === (parts[1] || ''));
                  });
                  if (composite) top = composite;
                }
                resolved = { name: String(top?.name || segCity), lat: Number(top?.lat || 0), lon: Number(top?.lon || 0), country: String(top?.country || '') };
                try { console.log('[WX] resolved', resolved); } catch {}
              }
            }
          } catch {}
          // debug removed

          if (resolved) {
            const q = `${resolved.lat},${resolved.lon}`;
            const results: { date: string; lo: number; hi: number; cond: string }[] = [];
            const within14 = (Date.parse(segStart) - Date.now())/(24*3600*1000) <= 14 && (Date.parse(segEnd) - Date.now())/(24*3600*1000) <= 14;
            if (within14) {
              const daysNeeded = Math.min(14, Math.max(1, Math.ceil((Date.parse(segEnd) - Date.now())/(24*3600*1000)) + 1));
              const url = `https://api.weatherapi.com/v1/forecast.json?key=${wxKey}&q=${encodeURIComponent(q)}&days=${daysNeeded}&aqi=no&alerts=no`;
              try { console.log('[WX] request', JSON.stringify({ endpoint: 'forecast', q, days: daysNeeded, start: segStart, end: segEnd })); } catch {}
              const resp = await fetch(url);
              if (resp.ok) {
                const data: any = await resp.json();
                const fdays: any[] = Array.isArray(data?.forecast?.forecastday) ? data.forecast.forecastday : [];
                for (const d of fdays) {
                  const dateStr = String(d?.date || '');
                  if (dateStr >= segStart && dateStr <= segEnd) {
                    results.push({ date: dateStr, lo: Math.round(d?.day?.mintemp_f ?? 0), hi: Math.round(d?.day?.maxtemp_f ?? 0), cond: String(d?.day?.condition?.text || '—') });
                  }
                }
              }
            } else {
              for (let t = Date.parse(segStart); t <= Date.parse(segEnd); t += 24*3600*1000) {
                const dt = new Date(t).toISOString().slice(0,10);
                const url = `https://api.weatherapi.com/v1/future.json?key=${wxKey}&q=${encodeURIComponent(q)}&dt=${dt}`;
                try { console.log('[WX] request', JSON.stringify({ endpoint: 'future', q, dt })); } catch {}
                const resp = await fetch(url);
                if (resp.ok) {
                  const data: any = await resp.json();
                  const day = data?.forecast?.forecastday?.[0]?.day;
                  if (day) {
                    results.push({ date: dt, lo: Math.round(day?.mintemp_f ?? 0), hi: Math.round(day?.maxtemp_f ?? 0), cond: String(day?.condition?.text || '—') });
                  }
                }
              }
            }
            if (results.length > 0) {
              const parts = results.map(r => `${r.date}: ${r.lo}°F–${r.hi}°F, ${r.cond}`);
              weatherSummary = `Weather for ${resolved.name} (${segStart} → ${segEnd})\n` + parts.join('\n');
              // debug removed
              try { console.log('[WX] summary', weatherSummary); } catch {}
            }
          }
        }
        if (!weatherSummary) {
          weatherSummary = segCity
            ? `Weather summary is unavailable right now for ${cityPhrase}.`
            : 'Weather summary unavailable: specify a city (e.g., “Weather in Denver”).';
          // debug removed
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
        } else if (tool === 'itinerary') {
          // Read trip dates for bounds
          const tripSnap = await db.collection('trips').doc(chatId).get();
          const startMs = tripSnap.exists ? ((tripSnap.data() as any)?.startDate ?? null) : null;
          const endMs = tripSnap.exists ? ((tripSnap.data() as any)?.endDate ?? null) : null;
          const startIso = startMs ? new Date(startMs).toISOString().slice(0,10) : '';
          const endIso = endMs ? new Date(endMs).toISOString().slice(0,10) : '';
          const bounds = startIso && endIso ? `Dates: ${startIso} to ${endIso}` : '';
          prompt = `Create a JSON array itinerary between the given dates. Return ONLY valid JSON (no code fences, no commentary). Each entry: {"date":"YYYY-MM-DD","items":["...", "..."]}. Use 3-6 concise activities per day. ${bounds}\n\nChat context (latest last):\n${context}`;
        } else if (tool === 'weather') {
          // Fallback: if we couldn't compute a summary above and no API key, return guidance
          prompt = `Return this text as-is (no formatting): Weather summary unavailable.`;
        } else {
          prompt = `Create a helpful plain-text draft for tool: ${tool}. Use the conversation as context.\n\nChat (latest last):\n${context}`;
        }
        const resp = await client.responses.create({ model: 'gpt-4.1-mini', input: prompt });
        const out = (resp as any)?.output_text || '';
        if (tool === 'itinerary') {
          // Try strict JSON parse, fallback to bracket extraction
          let parsed: any = null;
          try { parsed = JSON.parse(out); } catch {}
          if (!Array.isArray(parsed)) {
            try {
              const startIdx = out.indexOf('[');
              const endIdx = out.lastIndexOf(']');
              if (startIdx >= 0 && endIdx > startIdx) {
                const slice = out.slice(startIdx, endIdx + 1);
                parsed = JSON.parse(slice);
              }
            } catch {}
          }
          if (Array.isArray(parsed)) {
            itineraryOut = parsed.map((d: any) => ({ date: String(d?.date || ''), items: Array.isArray(d?.items) ? d.items.map((x: any) => String(x)) : [] }));
          } else {
            // As a fallback, construct empty itinerary for the date range
            const tripSnap = await db.collection('trips').doc(chatId).get();
            const s = tripSnap.exists ? ((tripSnap.data() as any)?.startDate ?? null) : null;
            const e = tripSnap.exists ? ((tripSnap.data() as any)?.endDate ?? null) : null;
            const arr: Array<{ date: string; items: string[] }> = [];
            if (s && e && e >= s) {
              for (let t = s; t <= e; t += 24*3600*1000) {
                arr.push({ date: new Date(t).toISOString().slice(0,10), items: [] });
              }
            }
            itineraryOut = arr;
          }
        } else if (out) {
          draftText = out;
        }
      } catch {}
    }

    const metaTool = resolvedTool || tool;
    if (tool === 'itinerary') {
      res.status(200).json({ itinerary: itineraryOut ?? [], meta: { tool: metaTool, chatId } });
      return;
    }
    res.status(200).json({ draft: { text: draftText }, meta: { tool: metaTool, chatId } });
  } catch (e: any) {
    const hasProject = !!process.env.FIREBASE_PROJECT_ID;
    const hasEmail = !!process.env.FIREBASE_CLIENT_EMAIL;
    const hasKey = !!process.env.FIREBASE_PRIVATE_KEY;
    res.status(500).json({ error: e?.message || 'Server error', env: { hasProject, hasEmail, hasKey } });
  }
}


