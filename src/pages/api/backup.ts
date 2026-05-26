import type { APIRoute } from 'astro';
import { getPool } from '../../lib/db';

export const GET: APIRoute = async () => {
  const { rows } = await getPool().query('SELECT id, owned, repeated FROM stickers WHERE owned = true OR repeated > 0');
  return new Response(JSON.stringify(rows, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="backup_stickers.json"' },
  });
};
