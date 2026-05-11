import type { APIRoute } from 'astro';
import { getPool } from '../../lib/db';
import { INTRO, FIFA_MUSEUM, TEAMS, COCA_COLA } from '../../lib/stickers';

export const GET: APIRoute = async () => {
  const client = await getPool().connect();
  try {
    await client.query('DROP TABLE IF EXISTS stickers');
    await client.query(`CREATE TABLE stickers (id TEXT PRIMARY KEY, owned BOOLEAN NOT NULL DEFAULT false)`);
    const all = [...INTRO, ...TEAMS.flatMap(t => t.stickers), ...FIFA_MUSEUM, ...COCA_COLA];
    const values = all.map((s, i) => `($${i + 1}, false)`).join(',');
    await client.query(`INSERT INTO stickers (id, owned) VALUES ${values}`, all.map(s => s.id));
    return new Response(`OK: ${all.length} stickers insertados`, { headers: { 'Content-Type': 'text/plain' } });
  } finally {
    client.release();
  }
};
