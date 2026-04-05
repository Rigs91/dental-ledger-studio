import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const PUBLIC_FILE = /\.(.*)$/;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === '/api/auth/signin' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/robots') ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  const signedIn = request.cookies.get('dls_signed_in')?.value === '1';
  if (pathname === '/signin') {
    if (signedIn) {
      const url = request.nextUrl.clone();
      url.pathname = request.nextUrl.searchParams.get('next') ?? '/';
      url.searchParams.delete('next');
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }
  if (!signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = '/signin';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
