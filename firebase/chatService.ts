import { db } from './config';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

export type MessageInput = {
  text?: string;
  imageUrl?: string;
};

export async function createChat(members: string[], initial?: MessageInput) {
  const chatRef = doc(collection(db, 'chats'));
  const now = Date.now();
  const payload: any = {
    type: members.length > 2 ? 'group' : 'direct',
    members,
    createdAt: now,
    lastMessage: initial?.text ?? '',
    lastMessageAt: now,
    readStatus: {},
  };
  await setDoc(chatRef, payload);
  if (initial && (initial.text || initial.imageUrl)) {
    await sendMessage(chatRef.id, members[0], initial);
  }
  return chatRef.id;
}

export async function sendMessage(chatId: string, senderId: string, data: MessageInput) {
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const now = Date.now();
  await addDoc(messagesRef, {
    senderId,
    text: data.text ?? null,
    imageUrl: data.imageUrl ?? null,
    timestamp: now,
    status: 'sent',
  });
  // update chat summary
  const chatRef = doc(db, 'chats', chatId);
  await updateDoc(chatRef, {
    lastMessage: data.text ?? (data.imageUrl ? '📷 Photo' : ''),
    lastMessageAt: now,
  });
}

export async function updateReadStatus(chatId: string, uid: string, opts?: { id?: string; at?: number }) {
  const chatRef = doc(db, 'chats', chatId);
  const now = Date.now();
  const at = typeof opts?.at === 'number' ? opts!.at! : now;
  const id = opts?.id ?? null;
  // Store both object shape (id + at) for new logic; legacy readers can still use 'at'
  await updateDoc(chatRef, { [`readStatus.${uid}`]: { id, at } as any });
}

export async function openDirectChat(uidA: string, uidB: string) {
  const members = [uidA, uidB].sort();
  const chatId = `direct_${members[0]}_${members[1]}`;
  const chatRef = doc(db, 'chats', chatId);
  const snap = await getDoc(chatRef);
  if (!snap.exists()) {
    const now = Date.now();
    await setDoc(chatRef, {
      type: 'direct',
      members,
      createdAt: now,
      lastMessage: '',
      lastMessageAt: now,
      readStatus: {},
    });
  }
  return chatId;
}

export async function createGroupChat(members: string[], groupName?: string, groupPhotoURL?: string) {
  if (members.length < 3) throw new Error('Group requires at least 3 members');
  if (members.length > 100) throw new Error('Max group size is 100');
  const chatRef = doc(collection(db, 'chats'));
  const now = Date.now();
  await setDoc(chatRef, {
    type: 'group',
    members,
    groupName: groupName || members.join(', '),
    groupPhotoURL: groupPhotoURL || null,
    createdAt: now,
    lastMessage: '',
    lastMessageAt: now,
    readStatus: {},
    // Chat-scoped metadata placeholders
    tripId: null,
    pollId: null,
    reminderId: null,
  });
  return chatRef.id;
}


