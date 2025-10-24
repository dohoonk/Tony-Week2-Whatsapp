import { auth } from '../firebase/config';

const API_BASE = process.env.EXPO_PUBLIC_AI_API_URL;

export async function fetchDraft(chatId: string, tool: string): Promise<{ text: string }> {
  if (!API_BASE) throw new Error('Missing EXPO_PUBLIC_AI_API_URL');
  const token = await auth.currentUser?.getIdToken(true);
  if (!token) throw new Error('Missing auth token');
  const res = await fetch(`${API_BASE}/api/ai/draft`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ chatId, tool }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Draft failed: ${res.status} ${msg}`);
  }
  const json = await res.json();
  return json.draft as { text: string };
}

export async function shareDraft(chatId: string, tool: string, draftText: string, dueAt?: number | null): Promise<void> {
  if (!API_BASE) throw new Error('Missing EXPO_PUBLIC_AI_API_URL');
  const token = await auth.currentUser?.getIdToken(true);
  if (!token) throw new Error('Missing auth token');
  const res = await fetch(`${API_BASE}/api/ai/share`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ chatId, tool, draft: { text: draftText, dueAt: typeof dueAt === 'number' ? dueAt : undefined } }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Share failed: ${res.status} ${msg}`);
  }
}


