import type { NextRequest } from 'next/server';
import { verifyIdToken } from '../_firebaseAdmin';

export async function requireAuth(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return { ok: false, status: 401 as const, error: 'Missing Authorization header' };
  }
  try {
    const decoded = await verifyIdToken(token);
    return { ok: true, uid: decoded.uid } as const;
  } catch (e: any) {
    return { ok: false, status: 401 as const, error: 'Invalid token' };
  }
}


