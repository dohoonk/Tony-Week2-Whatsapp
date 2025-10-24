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
      const reminder = {
        chatId,
        title: String(draft.text || '').trim(),
        dueAt: null, // parsing to be added later
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


