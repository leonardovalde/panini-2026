import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ cookies }) => {
  cookies.delete('auth', { path: '/' });
  return Response.redirect('/login', 302);
};
