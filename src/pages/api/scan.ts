import type { APIRoute } from 'astro';
import { getPool } from '../../lib/db';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.GCP_VISION_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GCP_VISION_KEY no configurada' }), { status: 500 });
  }

  const form = await request.formData();
  const file = form.get('image') as File;
  if (!file) return new Response(JSON.stringify({ error: 'No image' }), { status: 400 });

  const buffer = await file.arrayBuffer();
  const inputPath = join(tmpdir(), `scan_in_${Date.now()}`);
  const outputPath = join(tmpdir(), `scan_out_${Date.now()}.jpg`);
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

  // Call Google Cloud Vision OCR
  const visionRes = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [{ type: 'TEXT_DETECTION' }],
        }],
      }),
    }
  );

  const visionData = await visionRes.json();
  const rawText: string = visionData.responses?.[0]?.fullTextAnnotation?.text ?? '';

  if (!rawText) {
    return new Response(JSON.stringify({ 
      codes: [], owned: [], missing: [], rawText: '',
      debug: visionData.responses?.[0], annotations: []
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Get individual text annotations with bounding boxes
  const textAnnotations = visionData.responses?.[0]?.textAnnotations ?? [];

  // Extract sticker codes with their bounding boxes
  const codeRegex = /^([A-Z]{2,3})\s?(\d{1,2})$/;
  const annotationsWithBoxes: { code: string; box: any }[] = [];
  
  for (const ann of textAnnotations.slice(1)) { // skip first (full text)
    const text = ann.description?.trim();
    if (!text) continue;
    const match = text.match(codeRegex);
    if (match) {
      annotationsWithBoxes.push({ code: `${match[1]}${match[2]}`, box: ann.boundingPoly?.vertices });
    }
  }

  // Also try combining adjacent annotations (e.g. "KSA" + "2")
  for (let i = 0; i < textAnnotations.length - 1; i++) {
    const a = textAnnotations[i]?.description?.trim();
    const b = textAnnotations[i + 1]?.description?.trim();
    if (a && b && /^[A-Z]{2,3}$/.test(a) && /^\d{1,2}$/.test(b)) {
      const code = `${a}${b}`;
      const box = textAnnotations[i].boundingPoly?.vertices;
      if (!annotationsWithBoxes.find(x => x.code === code)) {
        annotationsWithBoxes.push({ code, box });
      }
    }
  }

  const codes = [...new Set(annotationsWithBoxes.map(a => a.code))];

  if (!codes.length) {
    return new Response(JSON.stringify({ codes: [], owned: [], missing: [], rawText, annotations: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check which ones are already owned
  const placeholders = codes.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await getPool().query(
    `SELECT id, owned FROM stickers WHERE id IN (${placeholders})`,
    codes
  );

  const found = new Map(rows.map(r => [r.id, r.owned]));
  const owned = codes.filter(c => found.get(c) === true);
  const newOnes = codes.filter(c => found.get(c) === false);
  const unknown = codes.filter(c => !found.has(c));

  return new Response(JSON.stringify({ codes, owned, new: newOnes, unknown, annotations: annotationsWithBoxes, imgWidth, imgHeight }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
