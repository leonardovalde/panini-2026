import type { APIRoute } from 'astro';

const PIN = import.meta.env.APP_PIN ?? '1234';

export const POST: APIRoute = async ({ request, cookies }) => {
  const { pin } = await request.json();
  if (pin === PIN) {
    cookies.set('auth', PIN, { path: '/', httpOnly: true, maxAge: 60 * 60 * 24 * 30 });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: false }), { status: 401, headers: { 'Content-Type': 'application/json' } });
};
