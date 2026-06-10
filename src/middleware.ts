import { type NextRequest, NextResponse } from 'next/server'

// Origins allowed regardless of the clients table (local dev).
const STATIC_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
]

// Allowed origins are derived from active clients' domains in Supabase, so
// onboarding a new client is a SQL insert — no code deploy. Cached in module
// scope; the REST call runs at most once per TTL per edge isolate.
const CACHE_TTL_MS = 5 * 60 * 1000
let cachedOrigins: Set<string> | null = null
let cacheLoadedAt = 0

async function loadAllowedOrigins(): Promise<Set<string>> {
  const now = Date.now()
  if (cachedOrigins && now - cacheLoadedAt < CACHE_TTL_MS) return cachedOrigins

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/clients?select=domain&active=eq.true`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY!}`,
        },
      }
    )
    if (!res.ok) throw new Error(`clients fetch failed: ${res.status}`)
    const rows: Array<{ domain: string | null }> = await res.json()

    const origins = new Set(STATIC_ORIGINS)
    for (const row of rows) {
      if (!row.domain) continue
      const bare = row.domain.trim().toLowerCase().replace(/^www\./, '')
      origins.add(`https://${bare}`)
      origins.add(`https://www.${bare}`)
    }

    cachedOrigins = origins
    cacheLoadedAt = now
  } catch (err) {
    console.error('[CORS] Failed to load client domains:', err)
    // Serve the stale cache if we have one; retry soon rather than in a full TTL
    if (!cachedOrigins) cachedOrigins = new Set(STATIC_ORIGINS)
    cacheLoadedAt = now - CACHE_TTL_MS + 30_000
  }

  return cachedOrigins
}

export async function middleware(request: NextRequest) {
  const origin = request.headers.get('origin')
  const response = NextResponse.next()

  // Handle CORS
  if (origin) {
    const allowed = await loadAllowedOrigins()
    if (allowed.has(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Access-Control-Allow-Credentials', 'true')
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, DELETE')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Supabase-Auth')
    }
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
