/**
 * Next.js Proxy
 *
 * Handles session refresh and protected route redirects.
 */

import { updateSession } from '@/lib/supabase/middleware';
import { type NextRequest, NextResponse } from 'next/server';

// Routes that require authentication
const protectedRoutes = [
  '/dashboard',
  '/send',
  '/withdraw',
  '/settings',
  '/transactions',
  '/contacts',
];

// Routes that should redirect to dashboard if already authenticated
const authRoutes = ['/login', '/verify'];

export async function proxy(request: NextRequest) {
  const { user, supabaseResponse } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Check if route is protected
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route),
  );

  // Check if route is auth route
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  // Redirect unauthenticated users from protected routes
  if (isProtectedRoute && !user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users from auth routes to dashboard
  if (isAuthRoute && user) {
    const redirectTo = request.nextUrl.searchParams.get('redirect');
    const destination = redirectTo || '/dashboard';
    return NextResponse.redirect(new URL(destination, request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc)
     * - api routes (handled separately)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|api).*)',
  ],
};
