import { auth } from '../firebase/config';

const API_BASE = process.env.EXPO_PUBLIC_AI_API_URL;

export async function fetchDraft(chatId: string, tool: string, payload?: Record<string, any>): Promise<{ text: string; tool?: string }> {
  if (!API_BASE) throw new Error('Missing EXPO_PUBLIC_AI_API_URL');
  const token = await auth.currentUser?.getIdToken(true);
  if (!token) throw new Error('Missing auth token');
  const res = await fetch(`${API_BASE}/api/ai/draft`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ chatId, tool, ...(payload || {}) }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Draft failed: ${res.status} ${msg}`);
  }
  const json = await res.json();
  return { ...(json.draft as { text: string }), tool: json?.meta?.tool };
}

export async function fetchPollSummary(chatId: string, poll: { question: string; options: string[]; counts: number[] }): Promise<{ text: string }> {
  if (!API_BASE) throw new Error('Missing EXPO_PUBLIC_AI_API_URL');
  const token = await auth.currentUser?.getIdToken(true);
  if (!token) throw new Error('Missing auth token');
  const res = await fetch(`${API_BASE}/api/ai/draft`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ chatId, tool: 'poll_summary', poll }),
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

export async function fetchTripWeather(chatId: string, city: string, start: string, end: string): Promise<{ city?: string; resolved?: { name: string; lat: number; lon: number }; days: Array<{ date: string; lo: number; hi: number; cond: string; icon?: string }> }> {
  if (!API_BASE) throw new Error('Missing EXPO_PUBLIC_AI_API_URL');
  const token = await auth.currentUser?.getIdToken(true);
  if (!token) throw new Error('Missing auth token');
  const res = await fetch(`${API_BASE}/api/tools/tripWeather`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ chatId, city, start, end }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Weather failed: ${res.status} ${msg}`);
  }
  return await res.json();
}

export async function fetchItinerary(chatId: string): Promise<Array<{ date: string; items: string[] }>> {
  if (!API_BASE) throw new Error('Missing EXPO_PUBLIC_AI_API_URL');
  const token = await auth.currentUser?.getIdToken(true);
  if (!token) throw new Error('Missing auth token');
  const res = await fetch(`${API_BASE}/api/ai/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ chatId, tool: 'itinerary' }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Itinerary failed: ${res.status} ${msg}`);
  }
  const json = await res.json();
  return Array.isArray(json.itinerary) ? json.itinerary : [];
}


