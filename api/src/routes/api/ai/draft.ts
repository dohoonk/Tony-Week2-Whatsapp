import type { NextRequest } from 'next/server';
import { requireAuth } from '../../../middleware/auth';
import { requireChatMembership } from '../../../middleware/authz';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: { 'content-type': 'application/json' } });

  const body = await req.json().catch(() => ({}));
  const { chatId, tool, payload } = body || {};
  const z = { chatId, tool };
  if (!z.chatId || !z.tool) return new Response(JSON.stringify({ error: 'chatId and tool are required' }), { status: 400, headers: { 'content-type': 'application/json' } });

  const authz = await requireChatMembership(chatId, auth.uid);
  if (!authz.ok) return new Response(JSON.stringify({ error: authz.error }), { status: authz.status, headers: { 'content-type': 'application/json' } });

  // Placeholder draft (wire model in a later task)
  const draft = { text: `[DRAFT:${tool}] This is a placeholder draft for chat ${chatId}.` };
  return new Response(JSON.stringify({ draft, meta: { tool, chatId } }), { status: 200, headers: { 'content-type': 'application/json' } });
}


