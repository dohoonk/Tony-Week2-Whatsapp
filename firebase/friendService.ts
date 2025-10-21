import { db } from './config';
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';

// friendRequests/{requestId}
export type FriendRequest = {
  fromUid: string;
  toUid: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
  respondedAt?: number;
};

export async function sendFriendRequest(fromUid: string, toUid: string) {
  const ref = collection(db, 'friendRequests');
  const now = Date.now();
  await addDoc(ref, { fromUid, toUid, status: 'pending', createdAt: now } as FriendRequest);
}

export async function listIncomingRequests(uid: string) {
  const ref = collection(db, 'friendRequests');
  const q = query(ref, where('toUid', '==', uid), where('status', '==', 'pending'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as FriendRequest) }));
}

export async function listOutgoingRequests(uid: string) {
  const ref = collection(db, 'friendRequests');
  const q = query(ref, where('fromUid', '==', uid), where('status', '==', 'pending'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as FriendRequest) }));
}

export async function acceptFriendRequest(requestId: string, fromUid: string, toUid: string) {
  // create symmetric friends docs
  const aRef = doc(db, 'friends', toUid, 'list', fromUid);
  const bRef = doc(db, 'friends', fromUid, 'list', toUid);
  const now = Date.now();
  await setDoc(aRef, { friendUid: fromUid, addedAt: now }, { merge: true });
  await setDoc(bRef, { friendUid: toUid, addedAt: now }, { merge: true });
  // delete or update request
  await deleteDoc(doc(db, 'friendRequests', requestId));
}

export async function declineFriendRequest(requestId: string) {
  await deleteDoc(doc(db, 'friendRequests', requestId));
}

export async function cancelOutgoingRequest(requestId: string) {
  await deleteDoc(doc(db, 'friendRequests', requestId));
}

export async function listFriends(uid: string) {
  const ref = collection(db, 'friends', uid, 'list');
  const snap = await getDocs(ref);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as { friendUid: string; addedAt: number }) }));
}


