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
      await chatRef.update({ lastMessage: msgText, lastMessageAt: now });
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
      await chatRef.update({ lastMessage: String(draft.text || ''), lastMessageAt: now });
    }
    res.status(200).json({ ok: true });
  } catch (e: any) {
    const hasProject = !!process.env.FIREBASE_PROJECT_ID;
    const hasEmail = !!process.env.FIREBASE_CLIENT_EMAIL;
    const hasKey = !!process.env.FIREBASE_PRIVATE_KEY;
    res.status(500).json({ error: e?.message || 'Server error', env: { hasProject, hasEmail, hasKey } });
  }
}


