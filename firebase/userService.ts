import { db } from './config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export type UserProfile = {
  displayName: string;
  photoURL?: string;
  email?: string;
  emailLower?: string;
  status?: 'online' | 'offline';
  statusMessage?: string;
  lastSeen?: number;
  createdAt?: number;
  updatedAt?: number;
  pushTokens?: string[];
};

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function upsertUserProfile(uid: string, profile: Partial<UserProfile>) {
  const ref = doc(db, 'users', uid);
  const now = Date.now();
  await setDoc(
    ref,
    {
      ...profile,
      updatedAt: now,
      createdAt: profile.createdAt ?? now,
    },
    { merge: true }
  );
}


