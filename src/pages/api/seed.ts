import type { APIRoute } from 'astro';
import { getPool } from '../../lib/db';
import { INTRO, FIFA_MUSEUM, TEAMS, COCA_COLA } from '../../lib/stickers';

export const GET: APIRoute = async () => {
  const client = await getPool().connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS stickers (id TEXT PRIMARY KEY, owned BOOLEAN NOT NULL DEFAULT false)`);
    const all = [...INTRO, ...TEAMS.flatMap(t => t.stickers), ...FIFA_MUSEUM, ...COCA_COLA];
    // INSERT only missing stickers, preserve existing owned status
    const values = all.map((s, i) => `($${i + 1}, false)`).join(',');
    const ids = all.map(s => s.id);
    await client.query(
      `INSERT INTO stickers (id, owned) VALUES ${values} ON CONFLICT (id) DO NOTHING`,
      ids
    );
    return new Response(`OK: ${all.length} stickers procesados (existentes sin cambios)`, { headers: { 'Content-Type': 'text/plain' } });
  } finally {
    client.release();
  }
};
