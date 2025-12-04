# HALOTRACK: First-Party Attribution System

Build a complete, GDPR-compliant, server-side attribution tracking system with the following specifications.

## PROJECT OVERVIEW

HaloTrack is a first-party analytics and attribution system for marketing agencies. It tracks visitors, attributes orders to marketing sources, and forwards conversion data to ad platforms (Facebook, Google).

Key principles:
- True first-party cookies (on client's domain, not ours)
- Server-side tracking (middleware, not client JS)
- GDPR compliant (two-mode: full tracking with consent, anonymous without)
- Multi-tenant (shared database with client_id separation)
- Per-client deployment (clone template for each client)

---

## TECH STACK

- Framework: Next.js 14+ (App Router)
- Database: Supabase (Postgres)
- Auth: Supabase Auth
- Hosting: Vercel
- Styling: Tailwind CSS
- Charts: Recharts

---

## ENVIRONMENT VARIABLES
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Client Config
CLIENT_ID=
SITE_DOMAIN=

# Admin (only for admin app)
ADMIN_EMAIL=
```

---

## DATABASE SCHEMA

Create these tables in Supabase SQL Editor:
```sql
-- =============================================
-- HALOTRACK SCHEMA
-- =============================================

-- CLIENTS TABLE (multi-tenant registry)
CREATE TABLE clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  
  -- Ad Platform Credentials
  settings JSONB DEFAULT '{
    "currency": "CZK",
    "timezone": "Europe/Prague",
    "facebook": {
      "pixel_id": null,
      "access_token": null,
      "test_event_code": null
    },
    "google": {
      "measurement_id": null,
      "api_secret": null
    }
  }',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT true
);

-- SESSIONS TABLE (full tracking with consent)
CREATE TABLE sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  
  -- First Touch Attribution
  ft_source TEXT,
  ft_medium TEXT,
  ft_campaign TEXT,
  ft_term TEXT,
  ft_content TEXT,
  ft_referrer TEXT,
  ft_referrer_full TEXT,
  ft_landing TEXT,
  ft_timestamp TIMESTAMPTZ,
  
  -- Last Touch Attribution
  lt_source TEXT,
  lt_medium TEXT,
  lt_campaign TEXT,
  lt_term TEXT,
  lt_content TEXT,
  lt_referrer TEXT,
  lt_landing TEXT,
  lt_timestamp TIMESTAMPTZ,
  
  -- Ad Platform Click IDs
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  fbclid TEXT,
  fbc TEXT,
  fbp TEXT,
  ttclid TEXT,
  msclkid TEXT,
  
  -- Device Info
  user_agent TEXT,
  device_type TEXT,
  browser TEXT,
  browser_version TEXT,
  os TEXT,
  os_version TEXT,
  
  -- Geo
  ip_hash TEXT,
  country TEXT,
  city TEXT,
  region TEXT,
  
  -- User Preferences
  language TEXT,
  
  -- Identity (for cross-device)
  email TEXT,
  phone TEXT,
  external_id TEXT,
  
  -- Consent
  consent_status TEXT DEFAULT 'unknown',
  
  -- Flexible Storage
  custom_params JSONB DEFAULT '{}',
  
  -- Meta
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(client_id, session_id)
);

-- ANONYMOUS EVENTS TABLE (no consent - minimal data)
CREATE TABLE anon_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  
  -- Only non-PII data
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  referrer_domain TEXT,
  page_path TEXT,
  
  -- For aggregate reporting
  event_type TEXT DEFAULT 'page_view',
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- EVENTS TABLE (tracked events with consent)
CREATE TABLE events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  
  -- Event Info
  event_name TEXT NOT NULL,
  event_category TEXT,
  event_value NUMERIC,
  currency TEXT,
  
  -- Page Context
  page_url TEXT,
  page_title TEXT,
  
  -- E-commerce
  items JSONB,
  
  -- Flexible
  properties JSONB DEFAULT '{}',
  
  -- Forwarding Status
  sent_to_facebook BOOLEAN DEFAULT false,
  sent_to_google BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ORDERS TABLE
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  
  -- Order Data
  external_order_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  
  -- Money
  total_amount NUMERIC(10,2),
  subtotal NUMERIC(10,2),
  tax NUMERIC(10,2),
  shipping NUMERIC(10,2),
  currency TEXT DEFAULT 'CZK',
  
  -- Customer
  customer_email TEXT,
  customer_phone TEXT,
  customer_id TEXT,
  
  -- Products
  items JSONB,
  
  -- Attribution
  session_id TEXT,
  attribution_data JSONB,
  match_type TEXT,
  days_to_convert INT,
  
  -- Forwarding Status
  sent_to_facebook BOOLEAN DEFAULT false,
  sent_to_google BOOLEAN DEFAULT false,
  facebook_event_id TEXT,
  google_event_id TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(client_id, external_order_id, platform)
);

-- INDEXES
CREATE INDEX idx_sessions_client ON sessions(client_id);
CREATE INDEX idx_sessions_sid ON sessions(client_id, session_id);
CREATE INDEX idx_sessions_email ON sessions(email) WHERE email IS NOT NULL;
CREATE INDEX idx_sessions_phone ON sessions(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_sessions_gclid ON sessions(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX idx_sessions_fbclid ON sessions(fbclid) WHERE fbclid IS NOT NULL;
CREATE INDEX idx_anon_events_client ON anon_events(client_id);
CREATE INDEX idx_anon_events_created ON anon_events(created_at);
CREATE INDEX idx_events_client ON events(client_id);
CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_orders_client ON orders(client_id);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_orders_email ON orders(customer_email) WHERE customer_email IS NOT NULL;

-- ROW LEVEL SECURITY
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE anon_events ENABLE ROW LEVEL SECURITY;

-- Policies: Service role has full access
CREATE POLICY "Service role full access" ON sessions FOR ALL USING (true);
CREATE POLICY "Service role full access" ON events FOR ALL USING (true);
CREATE POLICY "Service role full access" ON orders FOR ALL USING (true);
CREATE POLICY "Service role full access" ON anon_events FOR ALL USING (true);
```

---

## FILE STRUCTURE
```
halotrack/
├── middleware.ts                     # Server-side tracking
├── app/
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Landing redirect to dashboard
│   │
│   ├── login/
│   │   └── page.tsx                  # Client login page
│   │
│   ├── dashboard/
│   │   ├── layout.tsx                # Auth wrapper
│   │   ├── page.tsx                  # Main dashboard
│   │   └── components/
│   │       ├── StatsCards.tsx        # Key metrics
│   │       ├── RevenueBySource.tsx   # First/Last touch table
│   │       ├── RevenueChart.tsx      # Line chart over time
│   │       ├── RecentOrders.tsx      # Order list
│   │       ├── AttributionRate.tsx   # Match quality
│   │       └── DateRangePicker.tsx   # Date filter
│   │
│   ├── api/
│   │   ├── webhook/
│   │   │   └── order/
│   │   │       └── route.ts          # Receive order webhooks
│   │   │
│   │   ├── touch/
│   │   │   └── route.ts              # For external sites (JS loader)
│   │   │
│   │   ├── identify/
│   │   │   └── route.ts              # Link email to session
│   │   │
│   │   ├── event/
│   │   │   └── route.ts              # Track custom events
│   │   │
│   │   └── delete-user/
│   │       └── route.ts              # GDPR deletion endpoint
│   │
│   └── actions/
│       ├── auth.ts                   # Login/logout
│       └── dashboard.ts              # Data fetching
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts                 # Browser client
│   │   └── server.ts                 # Server client
│   │
│   ├── tracking/
│   │   ├── consent.ts                # Consent detection
│   │   ├── parse-request.ts          # Extract all data from request
│   │   └── user-agent.ts             # Parse device/browser/OS
│   │
│   ├── attribution/
│   │   └── match.ts                  # Session/email/phone matching
│   │
│   ├── forwarding/
│   │   ├── facebook.ts               # Facebook CAPI
│   │   └── google.ts                 # Google Enhanced Conversions
│   │
│   └── utils/
│       ├── hash.ts                   # SHA256 hashing
│       └── normalize.ts              # Phone/email normalization
│
├── public/
│   └── t.js                          # Lightweight JS loader for external sites
│
├── components/
│   └── ui/                           # Shadcn components
│
└── types/
    └── index.ts                      # TypeScript types
```

---

## CORE IMPLEMENTATION

### 1. MIDDLEWARE (middleware.ts)

Server-side tracking that runs on every page load:
```typescript
// middleware.ts

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

export async function middleware(request: NextRequest) {
  const response = NextResponse.next()
  const url = request.nextUrl
  const headers = request.headers
  
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
  } catch {}
  
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
```

### 2. ORDER WEBHOOK (app/api/webhook/order/route.ts)

Receives orders from WooCommerce, Shopify, or custom platforms:
```typescript
// app/api/webhook/order/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendToFacebook } from '@/lib/forwarding/facebook'
import { sendToGoogle } from '@/lib/forwarding/google'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Normalize order from different platforms
    const order = normalizeOrder(body)
    
    // === ATTRIBUTION MATCHING ===
    let session = null
    let matchType = 'none'
    
    // Priority 1: Session ID match (best)
    if (order.session_id) {
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('session_id', order.session_id)
        .eq('client_id', CLIENT_ID)
        .single()
      
      if (data) {
        session = data
        matchType = 'session'
      }
    }
    
    // Priority 2: Email match (cross-device)
    if (!session && order.email) {
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('email', order.email.toLowerCase().trim())
        .eq('client_id', CLIENT_ID)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()
      
      if (data) {
        session = data
        matchType = 'email'
      }
    }
    
    // Priority 3: Phone match
    if (!session && order.phone) {
      const normalizedPhone = normalizePhone(order.phone)
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('phone', normalizedPhone)
        .eq('client_id', CLIENT_ID)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()
      
      if (data) {
        session = data
        matchType = 'phone'
      }
    }
    
    // Priority 4: Customer ID match (returning customers)
    if (!session && order.customer_id) {
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('external_id', order.customer_id)
        .eq('client_id', CLIENT_ID)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()
      
      if (data) {
        session = data
        matchType = 'customer_id'
      }
    }
    
    // Calculate days to convert
    let daysToConvert = null
    if (session?.ft_timestamp) {
      const firstTouch = new Date(session.ft_timestamp)
      const orderDate = new Date()
      daysToConvert = Math.floor((orderDate.getTime() - firstTouch.getTime()) / 86400000)
    }
    
    // Build attribution data
    const attributionData = session ? {
      session_id: session.session_id,
      first_touch: {
        source: session.ft_source,
        medium: session.ft_medium,
        campaign: session.ft_campaign,
        term: session.ft_term,
        content: session.ft_content,
        referrer: session.ft_referrer,
        landing: session.ft_landing,
        timestamp: session.ft_timestamp,
      },
      last_touch: {
        source: session.lt_source,
        medium: session.lt_medium,
        campaign: session.lt_campaign,
        term: session.lt_term,
        content: session.lt_content,
        referrer: session.lt_referrer,
        landing: session.lt_landing,
        timestamp: session.lt_timestamp,
      },
      click_ids: {
        gclid: session.gclid,
        fbclid: session.fbclid,
        fbc: session.fbc,
        fbp: session.fbp,
        ttclid: session.ttclid,
      },
      device: {
        type: session.device_type,
        browser: session.browser,
        os: session.os,
        country: session.country,
      },
      match_type: matchType,
    } : {
      match_type: 'none',
    }
    
    // Generate event ID for deduplication
    const eventId = `${CLIENT_ID}_${order.external_id}_${Date.now()}`
    
    // === SAVE ORDER ===
    const { error: orderError } = await supabase.from('orders').upsert({
      client_id: CLIENT_ID,
      external_order_id: order.external_id,
      platform: order.platform,
      total_amount: order.total,
      subtotal: order.subtotal,
      tax: order.tax,
      shipping: order.shipping,
      currency: order.currency,
      customer_email: order.email,
      customer_phone: order.phone,
      customer_id: order.customer_id,
      items: order.items,
      session_id: session?.session_id || null,
      attribution_data: attributionData,
      match_type: matchType,
      days_to_convert: daysToConvert,
      facebook_event_id: eventId,
    }, { onConflict: 'client_id,external_order_id,platform' })
    
    if (orderError) throw orderError
    
    // === FORWARD TO AD PLATFORMS ===
    // Only if we have a session with consent
    let fbResult = null
    let googleResult = null
    
    if (session && session.consent_status !== 'denied') {
      // Get client settings
      const { data: clientData } = await supabase
        .from('clients')
        .select('settings')
        .eq('client_id', CLIENT_ID)
        .single()
      
      const settings = clientData?.settings || {}
      
      // Facebook CAPI
      if (settings.facebook?.pixel_id && settings.facebook?.access_token) {
        fbResult = await sendToFacebook({
          session,
          order,
          eventId,
          pixelId: settings.facebook.pixel_id,
          accessToken: settings.facebook.access_token,
          testEventCode: settings.facebook.test_event_code,
        })
        
        if (fbResult?.success) {
          await supabase.from('orders')
            .update({ sent_to_facebook: true })
            .eq('client_id', CLIENT_ID)
            .eq('external_order_id', order.external_id)
        }
      }
      
      // Google Enhanced Conversions
      if (settings.google?.measurement_id && settings.google?.api_secret) {
        googleResult = await sendToGoogle({
          session,
          order,
          measurementId: settings.google.measurement_id,
          apiSecret: settings.google.api_secret,
        })
        
        if (googleResult?.success) {
          await supabase.from('orders')
            .update({ sent_to_google: true })
            .eq('client_id', CLIENT_ID)
            .eq('external_order_id', order.external_id)
        }
      }
    }
    
    return NextResponse.json({
      success: true,
      attributed: matchType !== 'none',
      match_type: matchType,
      forwarded: {
        facebook: fbResult?.success || false,
        google: googleResult?.success || false,
      },
    })
    
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 }
    )
  }
}

// Normalize orders from different platforms
function normalizeOrder(body: any) {
  // WooCommerce format
  if (body.billing || body.line_items) {
    return {
      external_id: String(body.id || body.order_id),
      platform: 'woocommerce',
      total: parseFloat(body.total || 0),
      subtotal: parseFloat(body.subtotal || 0),
      tax: parseFloat(body.total_tax || 0),
      shipping: parseFloat(body.shipping_total || 0),
      currency: body.currency || 'CZK',
      email: body.billing?.email?.toLowerCase(),
      phone: body.billing?.phone,
      customer_id: body.customer_id ? String(body.customer_id) : null,
      session_id: body.meta_data?.find((m: any) => m.key === '_halo_session')?.value ||
                  body.halo_session_id,
      items: body.line_items?.map((item: any) => ({
        id: String(item.product_id),
        name: item.name,
        price: parseFloat(item.price),
        quantity: item.quantity,
      })),
    }
  }
  
  // Shopify format
  if (body.checkout_token || body.order_number) {
    const haloAttr = body.note_attributes?.find((a: any) => 
      a.name === 'halo_session_id' || a.name === '_halo_session'
    )
    
    return {
      external_id: String(body.id || body.order_number),
      platform: 'shopify',
      total: parseFloat(body.total_price || 0),
      subtotal: parseFloat(body.subtotal_price || 0),
      tax: parseFloat(body.total_tax || 0),
      shipping: parseFloat(body.total_shipping_price_set?.shop_money?.amount || 0),
      currency: body.currency || 'CZK',
      email: body.email?.toLowerCase() || body.customer?.email?.toLowerCase(),
      phone: body.phone || body.customer?.phone,
      customer_id: body.customer?.id ? String(body.customer.id) : null,
      session_id: haloAttr?.value,
      items: body.line_items?.map((item: any) => ({
        id: String(item.product_id),
        name: item.title,
        price: parseFloat(item.price),
        quantity: item.quantity,
      })),
    }
  }
  
  // Custom/generic format
  return {
    external_id: String(body.order_id || body.id),
    platform: body.platform || 'custom',
    total: parseFloat(body.total || body.total_amount || 0),
    subtotal: parseFloat(body.subtotal || 0),
    tax: parseFloat(body.tax || 0),
    shipping: parseFloat(body.shipping || 0),
    currency: body.currency || 'CZK',
    email: body.email?.toLowerCase() || body.customer_email?.toLowerCase(),
    phone: body.phone || body.customer_phone,
    customer_id: body.customer_id,
    session_id: body.session_id || body.halo_session_id,
    items: body.items,
  }
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}
```

### 3. FACEBOOK CAPI (lib/forwarding/facebook.ts)
```typescript
// lib/forwarding/facebook.ts

interface FacebookParams {
  session: any
  order: any
  eventId: string
  pixelId: string
  accessToken: string
  testEventCode?: string
}

export async function sendToFacebook(params: FacebookParams) {
  const { session, order, eventId, pixelId, accessToken, testEventCode } = params
  
  try {
    // Hash user data (Facebook requires SHA256)
    const hashedEmail = order.email ? await sha256(order.email.toLowerCase().trim()) : null
    const hashedPhone = order.phone ? await sha256(normalizePhone(order.phone)) : null
    const hashedCountry = session.country ? await sha256(session.country.toLowerCase()) : null
    const hashedCity = session.city ? await sha256(session.city.toLowerCase().replace(/\s/g, '')) : null
    
    const payload = {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        event_source_url: session.lt_landing || session.ft_landing,
        action_source: 'website',
        
        user_data: {
          em: hashedEmail ? [hashedEmail] : undefined,
          ph: hashedPhone ? [hashedPhone] : undefined,
          fbc: session.fbc || undefined,
          fbp: session.fbp || undefined,
          client_ip_address: session.ip_hash || undefined,
          client_user_agent: session.user_agent || undefined,
          country: hashedCountry ? [hashedCountry] : undefined,
          ct: hashedCity ? [hashedCity] : undefined,
        },
        
        custom_data: {
          value: order.total,
          currency: order.currency || 'CZK',
          content_ids: order.items?.map((i: any) => i.id) || [],
          content_type: 'product',
          num_items: order.items?.length || 1,
          contents: order.items?.map((i: any) => ({
            id: i.id,
            quantity: i.quantity,
            item_price: i.price,
          })),
        },
      }],
      ...(testEventCode && { test_event_code: testEventCode }),
    }
    
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )
    
    const result = await response.json()
    
    return {
      success: response.ok && !result.error,
      response: result,
    }
    
  } catch (error) {
    console.error('Facebook CAPI error:', error)
    return { success: false, error }
  }
}

async function sha256(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}
```

### 4. GOOGLE ENHANCED CONVERSIONS (lib/forwarding/google.ts)
```typescript
// lib/forwarding/google.ts

interface GoogleParams {
  session: any
  order: any
  measurementId: string
  apiSecret: string
}

export async function sendToGoogle(params: GoogleParams) {
  const { session, order, measurementId, apiSecret } = params
  
  try {
    const hashedEmail = order.email ? await sha256(order.email.toLowerCase().trim()) : null
    const hashedPhone = order.phone ? await sha256(normalizePhone(order.phone)) : null
    
    const payload = {
      client_id: session.session_id,
      events: [{
        name: 'purchase',
        params: {
          transaction_id: order.external_id,
          value: order.total,
          currency: order.currency || 'CZK',
          items: order.items?.map((item: any) => ({
            item_id: item.id,
            item_name: item.name,
            price: item.price,
            quantity: item.quantity,
          })) || [],
        },
      }],
      user_data: {
        sha256_email_address: hashedEmail || undefined,
        sha256_phone_number: hashedPhone || undefined,
      },
    }
    
    const response = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    )
    
    return {
      success: response.ok,
    }
    
  } catch (error) {
    console.error('Google EC error:', error)
    return { success: false, error }
  }
}

async function sha256(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}
```

### 5. IDENTIFY ENDPOINT (app/api/identify/route.ts)

Links email/phone to session (for cross-device):
```typescript
// app/api/identify/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const sessionId = request.cookies.get('_halo')?.value
    
    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'No session' }, { status: 400 })
    }
    
    const updateData: any = {}
    
    if (body.email) {
      updateData.email = body.email.toLowerCase().trim()
    }
    
    if (body.phone) {
      updateData.phone = body.phone.replace(/\D/g, '')
    }
    
    if (body.customer_id) {
      updateData.external_id = body.customer_id
    }
    
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: false, error: 'No data provided' }, { status: 400 })
    }
    
    const { error } = await supabase
      .from('sessions')
      .update(updateData)
      .eq('session_id', sessionId)
      .eq('client_id', CLIENT_ID)
    
    if (error) throw error
    
    return NextResponse.json({ success: true })
    
  } catch (error) {
    console.error('Identify error:', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
```

### 6. GDPR DELETION ENDPOINT (app/api/delete-user/route.ts)
```typescript
// app/api/delete-user/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')
    
    if (!email) {
      return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 })
    }
    
    const normalizedEmail = email.toLowerCase().trim()
    
    // Delete sessions
    await supabase
      .from('sessions')
      .delete()
      .eq('email', normalizedEmail)
      .eq('client_id', CLIENT_ID)
    
    // Delete events (via session_id would require lookup first)
    // For simplicity, we'll anonymize orders instead of deleting
    
    // Anonymize orders
    await supabase
      .from('orders')
      .update({
        customer_email: null,
        customer_phone: null,
        attribution_data: { deleted: true, deletion_date: new Date().toISOString() },
      })
      .eq('customer_email', normalizedEmail)
      .eq('client_id', CLIENT_ID)
    
    return NextResponse.json({ 
      success: true, 
      message: `Data deleted for ${normalizedEmail}` 
    })
    
  } catch (error) {
    console.error('Deletion error:', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
```

### 7. JS LOADER FOR EXTERNAL SITES (public/t.js)

Lightweight script for WooCommerce/Shopify sites:
```javascript
// public/t.js
// HaloTrack Loader - Add to external sites

(function() {
  var ENDPOINT = '{{SITE_URL}}/api/touch';
  var IDENTIFY_ENDPOINT = '{{SITE_URL}}/api/identify';
  
  // Parse URL params
  var params = new URLSearchParams(window.location.search);
  
  // Get UTMs and click IDs
  var data = {
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
    utm_term: params.get('utm_term'),
    utm_content: params.get('utm_content'),
    gclid: params.get('gclid'),
    fbclid: params.get('fbclid'),
    ttclid: params.get('ttclid'),
    msclkid: params.get('msclkid'),
    referrer: document.referrer || null,
    landing: window.location.pathname + window.location.search,
    page_title: document.title,
  };
  
  // Check consent (common CMPs)
  var consent = 'unknown';
  if (typeof window.CookieYes !== 'undefined') {
    var cky = window.CookieYes.getConsent();
    consent = cky.analytics ? 'granted' : 'denied';
  } else if (typeof window.Cookiebot !== 'undefined') {
    consent = window.Cookiebot.consent.statistics ? 'granted' : 'denied';
  }
  
  data.consent = consent;
  
  // Call server
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  })
  .then(function(r) { return r.json(); })
  .then(function(result) {
    window.HaloTrack = {
      sessionId: result.session_id,
      
      getSessionId: function() {
        return this.sessionId || getCookie('_halo');
      },
      
      identify: function(userData) {
        return fetch(IDENTIFY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(userData)
        });
      },
      
      track: function(eventName, properties) {
        return fetch('{{SITE_URL}}/api/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            event_name: eventName,
            properties: properties
          })
        });
      }
    };
    
    // Dispatch ready event
    window.dispatchEvent(new CustomEvent('halotrack:ready'));
  })
  .catch(function(err) {
    console.error('HaloTrack error:', err);
  });
  
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
  }
})();
```

### 8. DASHBOARD (app/dashboard/page.tsx)

Create a dashboard with:
- Stats cards: Total orders, Revenue, Attribution rate, Avg days to convert
- Revenue by source table (first-touch and last-touch tabs)
- Revenue over time chart (Recharts line chart)
- Recent orders list
- Date range picker

Use Supabase queries to fetch data filtered by client_id and date range.

Dashboard should be protected by Supabase Auth - redirect to /login if not authenticated.

### 9. LOGIN PAGE (app/login/page.tsx)

Simple login form using Supabase Auth:
- Email/password login
- Redirect to /dashboard on success
- Show error on failure

---

## ADDITIONAL REQUIREMENTS

1. **TypeScript**: Use TypeScript throughout with proper types

2. **Error Handling**: Wrap all async operations in try/catch, log errors

3. **Environment Variables**: Use process.env for all secrets

4. **Responsive Design**: Dashboard should work on mobile

5. **Dark Mode**: Use Tailwind dark mode classes, default to dark

6. **Loading States**: Show loading spinners while fetching data

7. **Empty States**: Handle cases where there's no data yet

---

## SHADCN COMPONENTS TO INSTALL
```bash
npx shadcn-ui@latest add button card input label table tabs select
```

---

## DEPLOYMENT CHECKLIST

1. Create Supabase project, run SQL schema
2. Deploy to Vercel
3. Set environment variables in Vercel
4. Add client's domain in Vercel
5. Client adds CNAME to DNS
6. Create client record in Supabase
7. Create Supabase Auth user for client
8. Test tracking with ?utm_source=test
9. Test order webhook
10. Verify data in dashboard

---

## BUILD THIS NOW

Start with:
1. Database schema (Supabase SQL)
2. middleware.ts
3. API routes (webhook/order, identify, delete-user, touch)
4. Forwarding functions (facebook.ts, google.ts)
5. Dashboard pages
6. Login page
7. JS loader (public/t.js)

Use best practices, clean code, proper error handling.