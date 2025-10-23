import { getAdminDb } from '../_firebaseAdmin';

export async function requireChatMembership(chatId: string, uid: string) {
  if (!chatId) return { ok: false as const, status: 400 as const, error: 'Missing chatId' };
  const db = getAdminDb();
  const snap = await db.collection('chats').doc(chatId).get();
  if (!snap.exists) return { ok: false as const, status: 404 as const, error: 'Chat not found' };
  const data = snap.data() as any;
  const members: string[] = Array.isArray(data?.members) ? data.members : [];
  if (!members.includes(uid)) return { ok: false as const, status: 403 as const, error: 'Forbidden' };
  return { ok: true as const, chat: { id: chatId, ...data } };
}


