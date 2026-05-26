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
  let imgWidth = 0, imgHeight = 0;
  try {
    execSync(`sips -s format jpeg "${inputPath}" --out "${outputPath}" 2>/dev/null || cp "${inputPath}" "${outputPath}"`);
    try {
      const info = execSync(`sips -g pixelWidth -g pixelHeight "${outputPath}" 2>/dev/null`).toString();
      imgWidth = parseInt(info.match(/pixelWidth:\s*(\d+)/)?.[1] ?? '0');
      imgHeight = parseInt(info.match(/pixelHeight:\s*(\d+)/)?.[1] ?? '0');
    } catch {}
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

  if (!rawText) return new Response(JSON.stringify({ codes: [], added: [], annotations: [], imgWidth, imgHeight }), { headers: { 'Content-Type': 'application/json' } });

  // Get annotations with bounding boxes
  const textAnnotations = visionData.responses?.[0]?.textAnnotations ?? [];
  const codeRegex = /^([A-Z]{2,3})\s?(\d{1,2})$/;
  const annotationsWithBoxes: { code: string; box: any }[] = [];
  for (const ann of textAnnotations.slice(1)) {
    const text = ann.description?.trim();
    if (!text) continue;
    const match = text.match(codeRegex);
    if (match) annotationsWithBoxes.push({ code: `${match[1]}${match[2]}`, box: ann.boundingPoly?.vertices });
  }
  for (let i = 0; i < textAnnotations.length - 1; i++) {
    const a = textAnnotations[i]?.description?.trim();
    const b = textAnnotations[i + 1]?.description?.trim();
    if (a && b && /^[A-Z]{2,3}$/.test(a) && /^\d{1,2}$/.test(b)) {
      const code = `${a}${b}`;
      if (!annotationsWithBoxes.find(x => x.code === code)) {
        annotationsWithBoxes.push({ code, box: textAnnotations[i].boundingPoly?.vertices });
      }
    }
  }

  // Count occurrences of each code (not unique — if SEN3 appears twice, add 2)
  const allCodes = [...rawText.matchAll(/\b([A-Z]{2,3})\s?(\d{1,2})\b/g)].map(m => `${m[1]}${m[2]}`).filter(c => c.length >= 3);
  const codeCounts = new Map<string, number>();
  allCodes.forEach(c => codeCounts.set(c, (codeCounts.get(c) ?? 0) + 1));
  const codes = [...codeCounts.keys()];

  if (!codes.length) return new Response(JSON.stringify({ codes: [], added: [] }), { headers: { 'Content-Type': 'application/json' } });

  // Increment repeated for each code by its occurrence count
  const pool = getPool();
  for (const [code, count] of codeCounts) {
    await pool.query('UPDATE stickers SET repeated = repeated + $1 WHERE id = $2', [count, code]);
  }

  // Get updated counts
  const placeholders = codes.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(`SELECT id, repeated FROM stickers WHERE id IN (${placeholders})`, codes);
  const results = rows.map(r => ({ id: r.id, repeated: r.repeated }));

  return new Response(JSON.stringify({ codes, added: results, annotations: annotationsWithBoxes, imgWidth, imgHeight }), { headers: { 'Content-Type': 'application/json' } });
};
