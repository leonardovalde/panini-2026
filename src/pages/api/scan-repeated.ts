import type { APIRoute } from 'astro';
import { getPool } from '../../lib/db';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.GCP_VISION_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'GCP_VISION_KEY no configurada' }), { status: 500 });

  const form = await request.formData();
  const file = form.get('image') as File;
  if (!file) return new Response(JSON.stringify({ error: 'No image' }), { status: 400 });

  const buffer = await file.arrayBuffer();
  const inputPath = join(tmpdir(), `scanr_in_${Date.now()}`);
  const outputPath = join(tmpdir(), `scanr_out_${Date.now()}.jpg`);
  writeFileSync(inputPath, Buffer.from(buffer));

  let base64: string;
  try {
    execSync(`sips -s format jpeg "${inputPath}" --out "${outputPath}" 2>/dev/null || cp "${inputPath}" "${outputPath}"`);
    base64 = readFileSync(outputPath).toString('base64');
  } finally {
    try { unlinkSync(inputPath); unlinkSync(outputPath); } catch {}
  }

  const visionRes = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: 'TEXT_DETECTION' }] }] }) }
  );
  const visionData = await visionRes.json();
  const rawText: string = visionData.responses?.[0]?.fullTextAnnotation?.text ?? '';

  if (!rawText) return new Response(JSON.stringify({ codes: [], added: [] }), { headers: { 'Content-Type': 'application/json' } });

  const codes = [...new Set([...rawText.matchAll(/\b([A-Z]{2,3})\s?(\d{1,2})\b/g)].map(m => `${m[1]}${m[2]}`).filter(c => c.length >= 3))];

  if (!codes.length) return new Response(JSON.stringify({ codes: [], added: [] }), { headers: { 'Content-Type': 'application/json' } });

  // Increment repeated for all detected codes
  const placeholders = codes.map((_, i) => `$${i + 1}`).join(',');
  await getPool().query(`UPDATE stickers SET repeated = repeated + 1 WHERE id IN (${placeholders})`, codes);

  // Get updated counts
  const { rows } = await getPool().query(`SELECT id, repeated FROM stickers WHERE id IN (${placeholders})`, codes);
  const results = rows.map(r => ({ id: r.id, repeated: r.repeated }));

  return new Response(JSON.stringify({ codes, added: results }), { headers: { 'Content-Type': 'application/json' } });
};
