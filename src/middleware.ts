import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client
// Note: In middleware we use the standard client, not auth helpers yet for simplicity in this specific tracking use case
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

export async function middleware(request: NextRequest) {
  const response = NextResponse.next()
  const url = request.nextUrl
  const headers = request.headers

  const origin = headers.get('origin')
  const allowedOrigins = [
    'https://haloagency.cz',
    'https://www.haloagency.cz',
    'https://www.propradlo.cz',
    'http://localhost:3000',
    'https://haloagency-website.vercel.app'
  ]

  // Handle Simple Requests (GET/POST) - Add CORS headers to response
  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }

  // Handle Preflight Requests (OPTIONS)
  if (request.method === 'OPTIONS') {
    if (origin && allowedOrigins.includes(origin)) {
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      })
    }
    return new NextResponse(null, { status: 200 })
  }

  // === CHECK FOR EXISTING SESSION ===
  const existingSessionId = request.cookies.get('_halo')?.value

  // === DETECT CONSENT ===
  // Read from common CMPs
  const consentCookie = request.cookies.get('cookieyes-consent')?.value ||
    request.cookies.get('CookieConsent')?.value ||
    request.cookies.get('cookie_consent')?.value

  let consentStatus = 'unknown'
  if (consentCookie) {
    // CookieYes format
    if (consentCookie.includes('analytics:yes') || consentCookie.includes('advertisement:yes')) {
      consentStatus = 'granted'
    } else if (consentCookie.includes('analytics:no')) {
      consentStatus = 'denied'
    }
    // Cookiebot format
    if (consentCookie.includes('statistics:true')) {
      consentStatus = 'granted'
    } else if (consentCookie.includes('statistics:false')) {
      consentStatus = 'denied'
    }
  }

  // === PARSE URL PARAMS ===
  const params = {
    utm_source: url.searchParams.get('utm_source'),
    utm_medium: url.searchParams.get('utm_medium'),
    utm_campaign: url.searchParams.get('utm_campaign'),
    utm_term: url.searchParams.get('utm_term'),
    utm_content: url.searchParams.get('utm_content'),
    gclid: url.searchParams.get('gclid'),
    gbraid: url.searchParams.get('gbraid'),
    wbraid: url.searchParams.get('wbraid'),
    fbclid: url.searchParams.get('fbclid'),
    ttclid: url.searchParams.get('ttclid'),
    msclkid: url.searchParams.get('msclkid'),
  }

  const hasNewCampaign = params.utm_source || params.gclid || params.fbclid || params.ttclid

  // === FAST PATH: No new data, existing session ===
  if (existingSessionId && !hasNewCampaign && consentStatus !== 'denied') {
    return response
  }

  // === PARSE REFERRER ===
  const refererFull = headers.get('referer')
  let refererDomain = null
  try {
    if (refererFull && !refererFull.includes(url.hostname)) {
      refererDomain = new URL(refererFull).hostname
    }
  } catch { }

  // === CONSENT DENIED: Anonymous tracking only ===
  if (consentStatus === 'denied') {
    // Store minimal anonymous event (no PII)
    if (params.utm_source || refererDomain) {
      await supabase.from('anon_events').insert({
        client_id: CLIENT_ID,
        utm_source: params.utm_source,
        utm_medium: params.utm_medium,
        utm_campaign: params.utm_campaign,
        utm_term: params.utm_term,
        utm_content: params.utm_content,
        referrer_domain: refererDomain,
        page_path: url.pathname,
        event_type: 'page_view',
      })
    }
    // No cookie set, no PII captured
    return response
  }

  // === CONSENT GRANTED OR UNKNOWN: Full tracking ===

  // Parse headers
  const userAgent = headers.get('user-agent') || ''
  const language = headers.get('accept-language')?.split(',')[0] || 'unknown'
  const ip = headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'

  // Vercel geo headers
  const country = headers.get('x-vercel-ip-country') || null
  const city = headers.get('x-vercel-ip-city') || null
  const region = headers.get('x-vercel-ip-region') || null

  // Hash IP for privacy
  const ipHash = await hashString(ip)

  // Parse user agent
  const device = parseUserAgent(userAgent)

  // === FACEBOOK COOKIES ===
  // fbc: Facebook click cookie (from fbclid)
  // fbp: Facebook browser ID
  let fbc = request.cookies.get('_fbc')?.value
  let fbp = request.cookies.get('_fbp')?.value

  // Generate if missing (Meta-approved regeneration)
  if (!fbc && params.fbclid) {
    fbc = `fb.1.${Date.now()}.${params.fbclid}`
  }
  if (!fbp) {
    fbp = `fb.1.${Date.now()}.${Math.floor(Math.random() * 10000000000)}`
  }

  // === BUILD TOUCH DATA ===
  const touch = {
    source: params.utm_source,
    medium: params.utm_medium,
    campaign: params.utm_campaign,
    term: params.utm_term,
    content: params.utm_content,
    referrer: refererDomain,
    referrer_full: refererFull,
    landing: url.pathname + url.search,
    timestamp: new Date().toISOString(),
  }

  const hasTouchData = touch.source || touch.referrer || params.gclid || params.fbclid

  // === NEW SESSION ===
  if (!existingSessionId) {
    const sessionId = crypto.randomUUID()

    await supabase.from('sessions').insert({
      client_id: CLIENT_ID,
      session_id: sessionId,
      consent_status: consentStatus,

      // First touch
      ft_source: touch.source,
      ft_medium: touch.medium,
      ft_campaign: touch.campaign,
      ft_term: touch.term,
      ft_content: touch.content,
      ft_referrer: touch.referrer,
      ft_referrer_full: touch.referrer_full,
      ft_landing: touch.landing,
      ft_timestamp: touch.timestamp,

      // Last touch (same as first initially)
      lt_source: touch.source,
      lt_medium: touch.medium,
      lt_campaign: touch.campaign,
      lt_term: touch.term,
      lt_content: touch.content,
      lt_referrer: touch.referrer,
      lt_landing: touch.landing,
      lt_timestamp: touch.timestamp,

      // Click IDs
      gclid: params.gclid,
      gbraid: params.gbraid,
      wbraid: params.wbraid,
      fbclid: params.fbclid,
      fbc: fbc,
      fbp: fbp,
      ttclid: params.ttclid,
      msclkid: params.msclkid,

      // Device
      user_agent: userAgent,
      device_type: device.type,
      browser: device.browser,
      browser_version: device.browserVersion,
      os: device.os,
      os_version: device.osVersion,

      // Geo
      ip_hash: ipHash,
      country: country,
      city: city,
      region: region,

      // User prefs
      language: language,

      // Store all URL params for flexibility
      custom_params: Object.fromEntries(url.searchParams.entries()),
    })

    // Set session cookie (365 days)
    response.cookies.set('_halo', sessionId, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 31536000,
      path: '/',
      sameSite: 'lax',
    })

    // Set Facebook cookies
    if (fbc) {
      response.cookies.set('_fbc', fbc, {
        httpOnly: false,
        secure: true,
        maxAge: 7776000, // 90 days
        path: '/',
        sameSite: 'lax',
      })
    }

    if (fbp) {
      response.cookies.set('_fbp', fbp, {
        httpOnly: false,
        secure: true,
        maxAge: 7776000,
        path: '/',
        sameSite: 'lax',
      })
    }

  } else if (hasTouchData) {
    // === RETURNING USER WITH NEW CAMPAIGN ===
    // Update last touch only, preserve first touch

    const updateData: any = {
      lt_source: touch.source,
      lt_medium: touch.medium,
      lt_campaign: touch.campaign,
      lt_term: touch.term,
      lt_content: touch.content,
      lt_referrer: touch.referrer,
      lt_landing: touch.landing,
      lt_timestamp: touch.timestamp,
      updated_at: new Date().toISOString(),
    }

    // Update click IDs if new ones present
    if (params.gclid) updateData.gclid = params.gclid
    if (params.fbclid) {
      updateData.fbclid = params.fbclid
      updateData.fbc = fbc
    }
    if (params.ttclid) updateData.ttclid = params.ttclid
    if (params.msclkid) updateData.msclkid = params.msclkid

    await supabase.from('sessions')
      .update(updateData)
      .eq('session_id', existingSessionId)
      .eq('client_id', CLIENT_ID)
  }

  return response
}

// === HELPERS ===

async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 32)
}

function parseUserAgent(ua: string) {
  let type = 'desktop'
  if (/mobile/i.test(ua)) type = 'mobile'
  else if (/tablet|ipad/i.test(ua)) type = 'tablet'

  let browser = 'Unknown'
  let browserVersion = ''
  if (/edg/i.test(ua)) {
    browser = 'Edge'
    browserVersion = ua.match(/edg\/(\d+)/i)?.[1] || ''
  } else if (/chrome/i.test(ua) && !/edg/i.test(ua)) {
    browser = 'Chrome'
    browserVersion = ua.match(/chrome\/(\d+)/i)?.[1] || ''
  } else if (/safari/i.test(ua) && !/chrome/i.test(ua)) {
    browser = 'Safari'
    browserVersion = ua.match(/version\/(\d+)/i)?.[1] || ''
  } else if (/firefox/i.test(ua)) {
    browser = 'Firefox'
    browserVersion = ua.match(/firefox\/(\d+)/i)?.[1] || ''
  }

  let os = 'Unknown'
  let osVersion = ''
  if (/windows/i.test(ua)) {
    os = 'Windows'
    osVersion = ua.match(/windows nt (\d+\.\d+)/i)?.[1] || ''
  } else if (/mac os/i.test(ua)) {
    os = 'macOS'
    osVersion = ua.match(/mac os x (\d+[._]\d+)/i)?.[1]?.replace('_', '.') || ''
  } else if (/iphone|ipad/i.test(ua)) {
    os = 'iOS'
    osVersion = ua.match(/os (\d+[._]\d+)/i)?.[1]?.replace('_', '.') || ''
  } else if (/android/i.test(ua)) {
    os = 'Android'
    osVersion = ua.match(/android (\d+\.?\d*)/i)?.[1] || ''
  }

  return { type, browser, browserVersion, os, osVersion }
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|t.js|.*\\.).*)'],
}
