import type { APIRoute } from 'astro';
import { getPool } from '../../lib/db';

// POST { id, delta: 1 | -1 }
export const POST: APIRoute = async ({ request }) => {
  const { id, delta } = await request.json();
  await getPool().query(
    'UPDATE stickers SET repeated = GREATEST(0, repeated + $1) WHERE id = $2',
    [delta, id]
  );
  const { rows } = await getPool().query('SELECT repeated FROM stickers WHERE id = $1', [id]);
  return new Response(JSON.stringify({ repeated: rows[0]?.repeated ?? 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
