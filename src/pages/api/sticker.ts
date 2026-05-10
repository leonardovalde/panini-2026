import type { APIRoute } from 'astro';
import { getPool } from '../../lib/db';

export const POST: APIRoute = async ({ request }) => {
  const { id, owned } = await request.json();
  await getPool().query('UPDATE stickers SET owned = $1 WHERE id = $2', [owned, id]);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
