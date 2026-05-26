import type { APIRoute } from 'astro';
import { getPool } from '../../lib/db';

export const POST: APIRoute = async () => {
  await getPool().query('UPDATE stickers SET repeated = 0 WHERE repeated > 0');
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
