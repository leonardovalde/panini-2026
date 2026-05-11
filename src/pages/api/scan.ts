import type { APIRoute } from 'astro';
import { getPool } from '../../lib/db';
import sharp from 'sharp';

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.GCP_VISION_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GCP_VISION_KEY no configurada' }), { status: 500 });
  }

  const form = await request.formData();
  const file = form.get('image') as File;
  if (!file) return new Response(JSON.stringify({ error: 'No image' }), { status: 400 });

  const buffer = await file.arrayBuffer();
  // Resize + convert to JPEG
  let jpegBuffer: Buffer;
  try {
    jpegBuffer = await sharp(Buffer.from(buffer))
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    // fallback: send as-is if sharp can't process (e.g. HEIC without plugin)
    jpegBuffer = Buffer.from(buffer);
  }
  const base64 = jpegBuffer.toString('base64');

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
  console.log('Vision full response:', JSON.stringify(visionData));
  const rawText: string = visionData.responses?.[0]?.fullTextAnnotation?.text ?? '';
  console.log('Vision raw text:', JSON.stringify(rawText));
  console.log('Vision error:', JSON.stringify(visionData.responses?.[0]?.error ?? 'none'));

  // Return raw vision data for debugging
  if (!rawText) {
    return new Response(JSON.stringify({ 
      codes: [], owned: [], missing: [], rawText: '',
      debug: visionData.responses?.[0]
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Extract sticker codes: 2-3 uppercase letters + optional space + 1-2 digits
  // Handles both "ARG17" and "KSA 2" and "TUN 16"
  const codes = [...new Set(
    [...rawText.matchAll(/\b([A-Z]{2,3})\s?(\d{1,2})\b/g)]
      .map(m => `${m[1]}${m[2]}`)
      .filter(c => c.length >= 3)
  )];

  if (!codes.length) {
    return new Response(JSON.stringify({ codes: [], owned: [], missing: [], rawText }), {
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

  return new Response(JSON.stringify({ codes, owned, new: newOnes, unknown }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
