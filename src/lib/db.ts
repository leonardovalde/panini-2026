import pg from 'pg';
import { INTRO, FIFA_MUSEUM, TEAMS, COCA_COLA } from './stickers.js';

const { Pool } = pg;
let pool: pg.Pool;

export function getPool() {
  if (!pool) pool = new Pool({ connectionString: import.meta.env.DATABASE_URL });
  return pool;
}

export async function initDB() {
  const client = await getPool().connect();
  try {
    await client.query('SET search_path = public');
    await client.query(`
      CREATE TABLE IF NOT EXISTS stickers (
        id TEXT PRIMARY KEY,
        owned BOOLEAN NOT NULL DEFAULT false,
        repeated INTEGER NOT NULL DEFAULT 0
      );
    `);
    await client.query(`ALTER TABLE stickers ADD COLUMN IF NOT EXISTS repeated INTEGER NOT NULL DEFAULT 0`);
    const { rows } = await client.query('SELECT COUNT(*) FROM stickers');
    if (parseInt(rows[0].count) === 0) {
      const all = [
        ...INTRO,
        ...TEAMS.flatMap(t => t.stickers),
        ...FIFA_MUSEUM,
        ...COCA_COLA,
      ];
      const values = all.map((s, i) => `($${i + 1}, false, 0)`).join(',');
      const ids = all.map(s => s.id);
      await client.query(`INSERT INTO stickers (id, owned, repeated) VALUES ${values}`, ids);
    }
  } finally {
    client.release();
  }
}
