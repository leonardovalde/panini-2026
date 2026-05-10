import { defineMiddleware } from 'astro:middleware';

const PIN = import.meta.env.APP_PIN ?? '1234';

export const onRequest = defineMiddleware(({ request, cookies, url }, next) => {
  const isLogin = url.pathname.startsWith('/login') || url.pathname.startsWith('/api/login');
  if (isLogin) return next();
  if (cookies.get('auth')?.value === PIN) return next();
  return Response.redirect(new URL('/login', request.url));
});
