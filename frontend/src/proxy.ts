import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED_PREFIXES = ['/teacher', '/student']
const SUPABASE_AUTH_COOKIE_MARKERS = ['-auth-token', 'sb-access-token', 'sb-refresh-token']

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

function hasSupabaseSessionCookie(request: NextRequest) {
  return request.cookies.getAll().some(cookie =>
    SUPABASE_AUTH_COOKIE_MARKERS.some(marker => cookie.name.includes(marker))
  )
}

export async function proxy(request: NextRequest) {
  if (isProtectedPath(request.nextUrl.pathname) && !hasSupabaseSessionCookie(request)) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  return NextResponse.next({ request })
}

export const config = {
  matcher: ['/teacher/:path*', '/student/:path*'],
}
