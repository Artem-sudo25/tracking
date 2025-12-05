# HaloTrack Technical Architecture

Complete module-by-module explanation of how HaloTrack works.

---

## System Overview

HaloTrack is a **server-side first-party attribution system** that:
1. Tracks visitor sessions via middleware (not client-side JavaScript)
2. Captures marketing attribution data (UTMs, referrers, click IDs)
3. Matches conversions (leads/orders) to sessions
4. Forwards conversion data to ad platforms (Facebook, Google)

**Key Principle:** Everything happens on the server to ensure accuracy and GDPR compliance.

---

## Module 1: Server-Side Tracking (Middleware)

**File:** [`src/middleware.ts`](file:///Users/artemhorvatsky/Documents/dev/tracking/src/middleware.ts)

### What It Does
Runs on **every page request** before the page loads. Captures attribution data and stores it in the database.

### How It Works

```
User visits: https://client.com/?utm_source=google&utm_campaign=summer
                    ↓
            Middleware intercepts request
                    ↓
    ┌───────────────┴───────────────┐
    │                               │
Check for     Parse URL params      Parse headers
_halo cookie  (UTMs, click IDs)     (user-agent, IP, geo)
    │                               │
    └───────────────┬───────────────┘
                    ↓
            Check consent status
                    ↓
    ┌───────────────┴───────────────┐
    │                               │
Consent denied              Consent granted/unknown
    │                               │
Store in                    Store in sessions table
anon_events                 (full attribution data)
    │                               │
    └───────────────┬───────────────┘
                    ↓
            Set _halo cookie
                    ↓
            Continue to page
```

### Key Features

1. **Session Creation**
   - New visitor → Create new session with UUID
   - Set `_halo` cookie (365 days)
   - Store **First Touch** attribution

2. **Session Update**
   - Returning visitor with new campaign → Update **Last Touch** attribution
   - Preserve First Touch data

3. **Consent Handling**
   - **Denied:** Store only anonymous data (no PII)
   - **Granted/Unknown:** Store full session data

4. **Data Captured**
   - UTM parameters (source, medium, campaign, term, content)
   - Click IDs (gclid, fbclid, ttclid, etc.)
   - Referrer (domain and full URL)
   - Device info (browser, OS, device type)
   - Geo data (country, city, region from Vercel headers)
   - Landing page URL

### Example Flow

```javascript
// User visits with Google Ads click
https://client.com/landing?utm_source=google&utm_medium=cpc&gclid=abc123

// Middleware creates session:
{
  session_id: "uuid-1234",
  ft_source: "google",
  ft_medium: "cpc",
  ft_campaign: null,
  gclid: "abc123",
  ft_landing: "/landing?utm_source=google...",
  ft_timestamp: "2025-12-05T14:00:00Z",
  device_type: "mobile",
  browser: "Chrome",
  country: "CZ"
}

// Cookie set: _halo=uuid-1234
```

---

## Module 2: Session Storage (Database)

**Tables:** `sessions`, `anon_events`

### Sessions Table

Stores **full visitor data** when consent is granted:

```sql
sessions {
  session_id: "uuid-1234",
  
  -- First Touch (never changes)
  ft_source: "google",
  ft_medium: "cpc",
  ft_campaign: "summer",
  ft_timestamp: "2025-12-05T14:00:00Z",
  
  -- Last Touch (updates on new campaign)
  lt_source: "facebook",
  lt_medium: "social",
  lt_campaign: "retargeting",
  lt_timestamp: "2025-12-06T10:00:00Z",
  
  -- Click IDs
  gclid: "abc123",
  fbclid: "xyz789",
  
  -- Identity (for cross-device matching)
  email: "user@example.com",  // Added via /api/identify
  phone: "+420123456789",
  
  -- Device
  device_type: "mobile",
  browser: "Chrome",
  os: "Android"
}
```

### Anonymous Events Table

Stores **minimal data** when consent is denied:

```sql
anon_events {
  utm_source: "google",
  utm_medium: "cpc",
  referrer_domain: "google.com",
  page_path: "/landing",
  event_type: "page_view"
  // NO email, phone, IP, or PII
}
```

---

## Module 3: Lead Tracking (Webhook)

**File:** [`src/app/api/webhook/lead/route.ts`](file:///Users/artemhorvatsky/Documents/dev/tracking/src/app/api/webhook/lead/route.ts)

### What It Does
Receives form submissions, matches them to sessions, and forwards to ad platforms.

### How It Works

```
Form submitted on client.com
        ↓
POST /api/webhook/lead
{
  email: "user@example.com",
  session_id: "uuid-1234",
  form_type: "contact"
}
        ↓
┌───────────────────────┐
│ Attribution Matching  │
└───────────────────────┘
        ↓
Priority 1: Session ID match
  → Find session where session_id = "uuid-1234"
        ↓
Priority 2: Email match
  → Find session where email = "user@example.com"
        ↓
Priority 3: Phone match
  → Find session where phone = "+420123456789"
        ↓
┌───────────────────────┐
│ Build Attribution     │
└───────────────────────┘
{
  first_touch: { source: "google", medium: "cpc" },
  last_touch: { source: "facebook", medium: "social" },
  match_type: "session",
  days_to_convert: 2
}
        ↓
┌───────────────────────┐
│ Save to leads table   │
└───────────────────────┘
        ↓
┌───────────────────────┐
│ Forward to Platforms  │
└───────────────────────┘
  ├─→ Facebook Lead Ads (if configured)
  └─→ Google Offline Conversions (if configured)
```

### Attribution Matching Priority

1. **Session ID** (best) - Direct match via cookie
2. **Email** - Cross-device matching
3. **Phone** - Alternative identifier
4. **None** - Lead saved but not attributed

### Example

```javascript
// User journey:
Day 1: Visits via Google Ads → session created (session_id: "uuid-1234")
Day 2: Visits via Facebook → session updated (last touch)
Day 3: Submits form with email

// Lead webhook receives:
{
  email: "user@example.com",
  session_id: "uuid-1234",  // From hidden field
  form_type: "contact"
}

// System matches to session and stores:
{
  lead_id: "lead_5678",
  email: "user@example.com",
  attribution_data: {
    first_touch: { source: "google", medium: "cpc" },
    last_touch: { source: "facebook", medium: "social" },
    match_type: "session",
    days_to_convert: 2
  }
}
```

---

## Module 4: Ad Platform Forwarding

**Files:** 
- [`src/lib/forwarding/facebook-lead.ts`](file:///Users/artemhorvatsky/Documents/dev/tracking/src/lib/forwarding/facebook-lead.ts)
- [`src/lib/forwarding/google-lead.ts`](file:///Users/artemhorvatsky/Documents/dev/tracking/src/lib/forwarding/google-lead.ts)

### What It Does
Sends conversion data back to Facebook and Google for campaign optimization.

### Facebook CAPI (Conversions API)

```
Lead submitted → HaloTrack
        ↓
Hash PII (SHA256):
  email → "a1b2c3..."
  phone → "d4e5f6..."
        ↓
Build payload:
{
  event_name: "Lead",
  event_time: 1733405000,
  user_data: {
    em: ["a1b2c3..."],  // Hashed email
    ph: ["d4e5f6..."],  // Hashed phone
    fbc: "fb.1.1733405000.xyz789",  // Facebook click ID
    fbp: "fb.1.1733405000.123456"   // Facebook browser ID
  },
  custom_data: {
    value: 50,
    currency: "CZK",
    content_name: "contact_form"
  }
}
        ↓
POST to Facebook Graph API
https://graph.facebook.com/v18.0/{pixel_id}/events
        ↓
Facebook attributes conversion to ad campaign
```

### Google Enhanced Conversions

```
Lead submitted → HaloTrack
        ↓
Hash PII (SHA256):
  email → "a1b2c3..."
        ↓
Build payload:
{
  client_id: "uuid-1234",
  events: [{
    name: "generate_lead",
    params: {
      value: 50,
      currency: "CZK"
    }
  }],
  user_data: {
    sha256_email_address: "a1b2c3..."
  }
}
        ↓
POST to Google Measurement Protocol
https://www.google-analytics.com/mp/collect
        ↓
Google attributes conversion to ad campaign
```

### Why Hashing?
- **Privacy:** Raw email/phone never sent to ad platforms
- **Matching:** Platforms can still match hashed data to their users
- **GDPR:** Compliant with data minimization principles

---

## Module 5: Cross-Device Tracking (Identify)

**File:** [`src/app/api/identify/route.ts`](file:///Users/artemhorvatsky/Documents/dev/tracking/src/app/api/identify/route.ts)

### What It Does
Links email/phone to a session for cross-device attribution.

### How It Works

```
User visits on Mobile → session_1 created
        ↓
User visits on Desktop → session_2 created
        ↓
User submits form with email on Desktop
        ↓
POST /api/identify
{
  email: "user@example.com",
  session_id: "session_2"  // From cookie
}
        ↓
Update session_2:
{
  session_id: "session_2",
  email: "user@example.com"  // Now linked
}
        ↓
Later: Lead webhook receives email
        ↓
Matches to session_2 (via email)
        ↓
Attribution data retrieved
```

### Usage Example

```javascript
// On form page (before submission)
window.HaloTrack.identify({
  email: "user@example.com",
  phone: "+420123456789"
})

// Now this session is linked to the email
// Future conversions can match even on different devices
```

---

## Module 6: Dashboard (Reporting)

**Files:**
- [`src/app/dashboard/page.tsx`](file:///Users/artemhorvatsky/Documents/dev/tracking/src/app/dashboard/page.tsx)
- [`src/app/actions/dashboard.ts`](file:///Users/artemhorvatsky/Documents/dev/tracking/src/app/actions/dashboard.ts)

### What It Does
Displays attribution metrics and conversion data.

### Data Flow

```
User logs in → Dashboard loads
        ↓
Server fetches data:
  - Get user's client_id
  - Query leads table
  - Query orders table
  - Calculate metrics
        ↓
Metrics calculated:
  - Total revenue
  - Total leads/orders
  - Attribution rate (% matched)
  - Avg days to convert
  - Revenue by source (first/last touch)
        ↓
Render components:
  - StatsCards
  - RevenueChart
  - RecentOrders
  - RevenueBySource
```

### Example Query

```sql
-- Get leads with attribution
SELECT 
  l.*,
  l.attribution_data->>'first_touch'->>'source' as ft_source,
  l.attribution_data->>'first_touch'->>'medium' as ft_medium
FROM leads l
WHERE l.client_id = 'client_acme'
  AND l.created_at >= '2025-12-01'
ORDER BY l.created_at DESC;
```

---

## Module 7: GDPR Compliance (Deletion)

**File:** [`src/app/api/delete-user/route.ts`](file:///Users/artemhorvatsky/Documents/dev/tracking/src/app/api/delete-user/route.ts)

### What It Does
Handles "Right to be Forgotten" requests.

### How It Works

```
DELETE /api/delete-user?email=user@example.com
        ↓
┌─────────────────────────┐
│ Delete from sessions    │
│ WHERE email = ...       │
└─────────────────────────┘
        ↓
┌─────────────────────────┐
│ Anonymize orders        │
│ SET email = NULL        │
│ SET phone = NULL        │
└─────────────────────────┘
        ↓
┌─────────────────────────┐
│ Anonymize leads         │
│ SET email = NULL        │
│ SET name = NULL         │
│ SET message = NULL      │
└─────────────────────────┘
        ↓
Return success
```

### Why Anonymize Instead of Delete?
- **Analytics:** Preserve aggregate metrics
- **Compliance:** PII removed = GDPR satisfied
- **Audit Trail:** Keep record of deletion date

---

## Module 8: External Script Loader

**File:** [`public/t.js`](file:///Users/artemhorvatsky/Documents/dev/tracking/public/t.js)

### What It Does
Lightweight JavaScript for external websites (e.g., client's landing page).

### How It Works

```html
<!-- On client's website -->
<script src="https://halotrack.vercel.app/t.js"></script>

<!-- Script loads and: -->
1. Parses URL params (UTMs, click IDs)
2. Checks consent status (CookieYes, Cookiebot)
3. Calls POST /api/touch with data
4. Receives session_id
5. Exposes window.HaloTrack API
```

### API Methods

```javascript
// Get session ID
window.HaloTrack.getSessionId()
// → "uuid-1234"

// Link email to session
window.HaloTrack.identify({
  email: "user@example.com"
})

// Track custom event
window.HaloTrack.track('button_click', {
  button_name: 'cta_hero'
})
```

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────┐
│                    User Journey                         │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Day 1: Visit via Google Ads                             │
│   → Middleware creates session                          │
│   → First Touch: google/cpc                             │
│   → Cookie: _halo=uuid-1234                             │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Day 2: Return via Facebook                              │
│   → Middleware updates session                          │
│   → Last Touch: facebook/social                         │
│   → First Touch preserved                               │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Day 3: Submit form                                      │
│   → POST /api/webhook/lead                              │
│   → Match via session_id                                │
│   → Attribution: FT=google, LT=facebook                 │
│   → Forward to Facebook & Google                        │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Dashboard shows:                                        │
│   - Lead attributed to Google (first touch)             │
│   - Days to convert: 2                                  │
│   - Facebook gets credit for assist (last touch)        │
└─────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### 1. First-Party Cookies
- Set on **client's domain** (not HaloTrack domain)
- Not blocked by browsers
- Accurate tracking

### 2. Server-Side Tracking
- Middleware runs on server
- No client-side JavaScript required for attribution
- Immune to ad blockers

### 3. Multi-Touch Attribution
- **First Touch:** Initial campaign that brought visitor
- **Last Touch:** Final campaign before conversion
- Both stored for complete picture

### 4. Session Matching
- **Session ID:** Best (direct link)
- **Email:** Good (cross-device)
- **Phone:** Good (alternative)
- **None:** Lead saved but not attributed

### 5. GDPR Compliance
- **Consent-based:** Respects CMP decisions
- **Anonymous mode:** No PII when consent denied
- **Right to deletion:** Anonymize on request
- **Data minimization:** Only store necessary data

---

## Performance Optimizations

1. **Fast Path in Middleware**
   - Skip processing if no new campaign data
   - Reduces database calls

2. **Indexed Queries**
   - All lookups use indexed columns
   - Fast session matching

3. **Async Forwarding**
   - Ad platform calls don't block response
   - User sees instant form confirmation

4. **Cookie-Based Sessions**
   - No server-side session storage
   - Scales infinitely

---

## Security Features

1. **IP Hashing**
   - IP addresses hashed before storage
   - Privacy-preserving

2. **PII Hashing for Ad Platforms**
   - Email/phone hashed with SHA256
   - Never sent in plain text

3. **Row Level Security**
   - Supabase RLS policies
   - Client data isolation

4. **Service Key Protection**
   - Only server has access
   - Never exposed to client

---

This architecture ensures **accurate attribution**, **GDPR compliance**, and **scalability** for multi-tenant SaaS deployment.
