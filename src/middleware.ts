import { type NextRequest, NextResponse } from 'next/server'

const ALLOWED_ORIGINS = [
  'https://www.haloagency.cz',
  'https://haloagency.cz',
  'http://localhost:3000',
  'http://localhost:3001'
]

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin')
  const response = NextResponse.next()

  // Handle CORS
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, DELETE')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Supabase-Auth')
  }

  // Handle Simple Preflight Request (OPTIONS)
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: response.headers,
    })
  }

  return response
}

export const config = {
  matcher: [
    '/api/:path*', // Apply to all API routes
  ],
}
