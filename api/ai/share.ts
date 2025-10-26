// Plain Node-style handler with inline Firebase Admin

let admin: any;
try { admin = require('firebase-admin'); } catch {}
let __adminApp: any = null;
function getAdminApp() {
  if (__adminApp) return __adminApp;
  if (!admin) throw new Error('firebase-admin not installed');
  const projectId = process.env.FIREBASE_PROJECT_ID as string;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL as string;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY as string;
  const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, '\n') : undefined;
  if (!projectId || !clientEmail || !privateKey) throw new Error('Missing Firebase Admin credentials');
  __adminApp = admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  return __adminApp;
}
function getAdminDb() { return getAdminApp().firestore(); }
async function verifyIdToken(idToken: string) { return await getAdminApp().auth().verifyIdToken(idToken); }

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const auth = req.headers?.authorization || '';
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) { res.status(401).json({ error: 'Missing Authorization header' }); return; }
    const decoded = await verifyIdToken(token);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { chatId, tool, draft } = body as any;
    if (!chatId || !draft?.text) { res.status(400).json({ error: 'chatId and draft.text are required' }); return; }
    const db = getAdminDb();
    const chatRef = db.collection('chats').doc(chatId);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) { res.status(404).json({ error: 'Chat not found' }); return; }
    const members: string[] = Array.isArray((chatSnap.data() as any)?.members) ? (chatSnap.data() as any).members : [];
    if (!members.includes(decoded.uid)) { res.status(403).json({ error: 'Forbidden' }); return; }
    const now = Date.now();
    if (tool === 'reminder') {
      // Create reminder doc
      // naive parsing: time like "7:30 PM" and words today/tomorrow
      const raw = String(draft.text || '');
      let dueAt: number | null = null;
      try {
        const timeMatch = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        const isTomorrow = /tomorrow/i.test(raw);
        const isToday = /today/i.test(raw);
        if (timeMatch) {
          const hour = parseInt(timeMatch[1], 10);
          const minute = parseInt(timeMatch[2], 10);
          const ampm = timeMatch[3].toUpperCase();
          let h24 = hour % 12 + (ampm === 'PM' ? 12 : 0);
          const base = new Date();
          if (isTomorrow) base.setDate(base.getDate() + 1);
          if (!isTomorrow && !isToday) {
            // default to today
          }
          base.setHours(h24, minute, 0, 0);
          dueAt = base.getTime();
        }
      } catch {}

      const reminder = {
        chatId,
        title: String(draft.text || '').trim(),
        dueAt: typeof draft?.dueAt === 'number' ? draft.dueAt : dueAt, // respect client override
        status: 'scheduled',
        members,
        createdBy: decoded.uid,
        createdAt: now,
      };
      const reminderRef = await db.collection('reminders').add(reminder);
      // Post a reference message in chat
      const msgText = `Reminder set: ${reminder.title}`;
      await chatRef.collection('messages').add({
        senderId: 'ai',
        text: msgText,
        imageUrl: null,
        timestamp: now,
        type: 'ai_response',
        visibility: 'shared',
        relatedFeature: 'reminder',
        relatedId: reminderRef.id,
        createdBy: decoded.uid,
      });
      await chatRef.update({ lastMessage: msgText, lastMessageAt: now });
    } else if (tool === 'poll') {
      // Parse poll from draft text: expect "Question:" and list of "- option"
      const raw = String(draft.text || '');
      const qMatch = raw.match(/Question:\s*(.*)/i);
      const question = (qMatch?.[1] || raw.split('\n')[0] || '').trim();
      const optionLines = raw.split('\n').filter((l: string) => /^\s*-\s+/.test(l));
      const options = optionLines.map((l: string) => l.replace(/^\s*-\s+/, '').trim()).filter(Boolean).slice(0, 10);
      const poll = {
        chatId,
        question,
        options,
        votes: {}, // { [uid]: optionIndex }
        status: 'open',
        createdBy: decoded.uid,
        createdAt: now,
      } as any;
      const pollRef = await db.collection('polls').add(poll);
      const msgText = `Poll: ${question}`;
      await chatRef.collection('messages').add({
        senderId: 'ai',
        text: msgText,
        imageUrl: null,
        timestamp: now,
        type: 'ai_response',
        visibility: 'shared',
        relatedFeature: 'poll',
        relatedId: pollRef.id,
        createdBy: decoded.uid,
      });
      await chatRef.update({ lastMessage: msgText, lastMessageAt: now, pollId: pollRef.id } as any);
    } else if (tool === 'trip') {
      // Upsert single active trip per chat: trips/{chatId}
      // Try to derive a useful title: Destination - startDate - endDate
      const raw: string = String(draft.text || '');

      // Summarize recent chat context to drive extraction, instead of the draft text
      let summaryText: string | null = null;
      try {
        const msgsSnap = await chatRef.collection('messages').orderBy('timestamp', 'desc').limit(200).get();
        const desc = msgsSnap.docs
          .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
          .filter((m: any) => !m.imageUrl && String(m.type || '') !== 'ai_response' && typeof m.text === 'string');
        const asc = desc.slice().reverse();
        const joined = asc.map((m: any) => String(m.text)).join('\n');
        const openaiKey = process.env.OPENAI_API_KEY as string | undefined;
        if (openaiKey && joined) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { OpenAI } = require('openai');
          const client = new OpenAI({ apiKey: openaiKey });
          const prompt = `Summarize this chat planning context in <=150 words, focusing only on destination and trip timing cues. Plain text only.\n\n${joined}`;
          try { console.log('[TRIP] extractorContextPrompt', prompt.slice(0, 2000)); } catch {}
          const resp = await client.responses.create({ model: 'gpt-4.1-mini', input: prompt });
          const out: string = String((resp as any)?.output_text || '').trim();
          summaryText = out || null;
          try { console.log('[TRIP] extractorContextSummary', summaryText?.slice(0, 500)); } catch {}
        } else {
          // Fallback: truncate raw join as pseudo-summary
          summaryText = joined.slice(-8000);
        }
      } catch {}

      // LLM extractor for destination and dates (safe fallback to regex below)
      let llmCity: string | undefined;
      let llmStart: string | undefined;
      let llmEnd: string | undefined;
      try {
        const openaiKey = process.env.OPENAI_API_KEY as string | undefined;
        if (openaiKey) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { OpenAI } = require('openai');
          const client = new OpenAI({ apiKey: openaiKey });
          const baseText = (summaryText && summaryText.trim().length > 0) ? summaryText : raw;
          const extractor = `Extract destination city and a start/end date for a trip.\nReturn ONLY JSON: { "city": string, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }.\nIf dates are missing, infer from the summary if possible; otherwise leave empty.\nSummary:\n${baseText}`;
          try { console.log('[TRIP] extractorPrompt', extractor); } catch {}
          const resp = await client.responses.create({ model: 'gpt-4.1-mini', input: extractor });
          const out: string = String((resp as any)?.output_text || '').trim();
          try { console.log('[TRIP] extractorRaw', out); } catch {}
          try {
            let jsonText = out;
            // Strip markdown fences if present and extract first JSON object
            const fence = /```[a-zA-Z]*\n([\s\S]*?)```/m.exec(out);
            if (fence && fence[1]) jsonText = fence[1].trim();
            const brace = /\{[\s\S]*\}/.exec(jsonText);
            if (brace && brace[0]) jsonText = brace[0];
            const parsed = JSON.parse(jsonText);
            llmCity = typeof parsed?.city === 'string' ? parsed.city.trim() : undefined;
            llmStart = typeof parsed?.start === 'string' ? parsed.start.trim() : undefined;
            llmEnd = typeof parsed?.end === 'string' ? parsed.end.trim() : undefined;
            try { console.log('[TRIP] extractorParsed', { llmCity, llmStart, llmEnd }); } catch {}
          } catch {}
        }
      } catch {}

      const months = '(January|February|March|April|May|June|July|August|September|October|November|December)';
      // Title: city from extractor (fallback 'Trip')
      const dest = (llmCity && llmCity.length >= 1 ? llmCity : 'Trip') as string;
      const startStr = (llmStart || '') as string;
      const endStr = (llmEnd || '') as string;
      // Title: city only (dest)
      let title = `${dest}`;

      // Try to convert parsed strings into numeric ms
      const parseToMs = (s: string): number | null => {
        const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (iso) {
          const y = parseInt(iso[1], 10);
          const m = parseInt(iso[2], 10) - 1;
          const d = parseInt(iso[3], 10);
          const dt = new Date(y, m, d);
          return isNaN(dt.getTime()) ? null : dt.getTime();
        }
      const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
        if (slash) {
          const m = Math.max(1, Math.min(12, parseInt(slash[1], 10))) - 1;
          const d = Math.max(1, Math.min(31, parseInt(slash[2], 10)));
          const y = slash[3].length === 2 ? 2000 + parseInt(slash[3], 10) : parseInt(slash[3], 10);
          const dt = new Date(y, m, d);
          return isNaN(dt.getTime()) ? null : dt.getTime();
        }
        const monthRe = new RegExp(`^${months}\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?$`, 'i');
        const mm = monthRe.exec(s);
        if (mm) {
          const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
          const name = s.split(/\s+/)[0].toLowerCase();
          const idx = monthNames.indexOf(name);
          const day = parseInt(mm[1], 10);
          const year = mm[2] ? parseInt(mm[2], 10) : (new Date()).getFullYear();
          const dt = new Date(year, idx, day);
          return isNaN(dt.getTime()) ? null : dt.getTime();
        }
        return null;
      };
      const sMsRaw = parseToMs(startStr);
      const eMsRaw = parseToMs(endStr);
      const startMs = sMsRaw && eMsRaw ? Math.min(sMsRaw, eMsRaw) : (sMsRaw ?? null);
      const endMs = sMsRaw && eMsRaw ? Math.max(sMsRaw, eMsRaw) : (eMsRaw ?? sMsRaw ?? null);

      const tripRef = db.collection('trips').doc(chatId);
      const tripSnap = await tripRef.get();
      const baseVer = tripSnap.exists ? ((tripSnap.data() as any)?.version || 0) : 0;
      await tripRef.set({
        chatId,
        members,
        title,
        notes: String(draft.text || ''),
        startDate: startMs ?? (tripSnap.exists ? ((tripSnap.data() as any)?.startDate ?? null) : null),
        endDate: endMs ?? (tripSnap.exists ? ((tripSnap.data() as any)?.endDate ?? null) : null),
        version: baseVer + 1,
        updatedBy: decoded.uid,
        updatedAt: now,
        createdAt: tripSnap.exists ? ((tripSnap.data() as any)?.createdAt || now) : now,
        createdBy: tripSnap.exists ? ((tripSnap.data() as any)?.createdBy || decoded.uid) : decoded.uid,
      }, { merge: true });
      await chatRef.update({ lastMessage: `Trip plan updated (v${baseVer + 1})`, lastMessageAt: now, tripId: chatId } as any);
      await chatRef.collection('messages').add({
        senderId: 'ai',
        text: `Trip plan updated (v${baseVer + 1})`,
        imageUrl: null,
        timestamp: now,
        type: 'ai_response',
        visibility: 'shared',
        relatedFeature: 'trip',
        relatedId: chatId,
        createdBy: decoded.uid,
      });
    } else {
      // Default: post AI response message
      await chatRef.collection('messages').add({
        senderId: 'ai',
        text: String(draft.text || ''),
        imageUrl: null,
        timestamp: now,
        type: 'ai_response',
        visibility: 'shared',
        relatedFeature: tool || 'ai',
        createdBy: decoded.uid,
      });
      await chatRef.update({ lastMessage: String(draft.text || ''), lastMessageAt: now } as any);
    }
    res.status(200).json({ ok: true });
  } catch (e: any) {
    const hasProject = !!process.env.FIREBASE_PROJECT_ID;
    const hasEmail = !!process.env.FIREBASE_CLIENT_EMAIL;
    const hasKey = !!process.env.FIREBASE_PRIVATE_KEY;
    res.status(500).json({ error: e?.message || 'Server error', env: { hasProject, hasEmail, hasKey } });
  }
}


