import type { APIRoute } from 'astro';
import { getPool } from '../../lib/db';

// Migration: remap old CC IDs to new order
// Old: CC3=Kane, CC4=Giménez, CC5=Robinson, CC6=Lerma, CC7=Álvarez, CC8=van Dijk, CC9=Davies, CC10=McKennie, CC11=Martínez
// New: CC3=van Dijk, CC4=Robinson, CC5=Davies, CC6=Martínez, CC7=Kane, CC8=Álvarez, CC9=McKennie, CC10=Lerma, CC11=Giménez

export const GET: APIRoute = async () => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('SET search_path = public');
    
    // Read current state of CC3-CC11
    const { rows } = await client.query(
      `SELECT id, owned, repeated FROM stickers WHERE id IN ('CC3','CC4','CC5','CC6','CC7','CC8','CC9','CC10','CC11')`
    );
    const old = Object.fromEntries(rows.map(r => [r.id, { owned: r.owned, repeated: r.repeated }]));

    // Mapping: old_id -> new_id
    // Old CC3 (Kane) -> New CC7
    // Old CC4 (Giménez) -> New CC11
    // Old CC5 (Robinson) -> New CC4
    // Old CC6 (Lerma) -> New CC10
    // Old CC7 (Álvarez) -> New CC8
    // Old CC8 (van Dijk) -> New CC3
    // Old CC9 (Davies) -> New CC5
    // Old CC10 (McKennie) -> New CC9
    // Old CC11 (Martínez) -> New CC6
    const remap = [
      ['CC3', 'CC7'],  // Kane
      ['CC4', 'CC11'], // Giménez
      ['CC5', 'CC4'],  // Robinson
      ['CC6', 'CC10'], // Lerma
      ['CC7', 'CC8'],  // Álvarez
      ['CC8', 'CC3'],  // van Dijk
      ['CC9', 'CC5'],  // Davies
      ['CC10', 'CC9'], // McKennie
      ['CC11', 'CC6'], // Martínez
    ];

    // Reset all to false/0 first
    await client.query(`UPDATE stickers SET owned = false, repeated = 0 WHERE id IN ('CC3','CC4','CC5','CC6','CC7','CC8','CC9','CC10','CC11')`);

    // Apply remapped values
    for (const [oldId, newId] of remap) {
      const data = old[oldId];
      if (data) {
        await client.query(`UPDATE stickers SET owned = $1, repeated = $2 WHERE id = $3`, [data.owned, data.repeated, newId]);
      }
    }

    return new Response(`OK: migración completada.\n${remap.map(([o, n]) => `${o} -> ${n}: owned=${old[o]?.owned}, repeated=${old[o]?.repeated}`).join('\n')}`, {
      headers: { 'Content-Type': 'text/plain' },
    });
  } finally {
    client.release();
  }
};
