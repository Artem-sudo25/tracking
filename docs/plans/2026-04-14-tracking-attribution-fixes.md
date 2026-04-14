# Tracking & Attribution Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 7 tracking issues causing lost attribution data across HaloTrack, HaloAgency website, and CatCafe website — recovering conversion signals for Facebook CAPI and Google Ads.

**Architecture:** Fixes span 3 repos (tracking platform, haloagency-website, catcafe website). Most critical fixes are in the tracking platform's session creation (`/api/touch`) and client-side script (`t.js`). The approach is: fix data capture at the source (session creation), then fix forwarding (lead webhook), then fix client-side resilience.

**Tech Stack:** Next.js API routes (TypeScript), Supabase (PostgreSQL), Facebook Conversions API, Google Measurement Protocol, vanilla JS (t.js client script)

**Repos:**
- `tracking` → `/Users/artemhorvatsky/Documents/dev/tracking`
- `haloagency-website` → `/Users/artemhorvatsky/Documents/dev/haloagency-website`
- `catcafe` → `/Users/artemhorvatsky/Documents/projects/catcafe/website/catcafe-prague`

---

## Phase 1: Critical Data Loss Fixes (Issues #1, #2, #3)

### Task 1: Fix country/city never being stored on sessions (Issue #5)

This is the simplest fix and unblocks Issue #4 (fbc) improvements.

**Files:**
- Modify: `tracking/src/app/api/touch/route.ts:122-167` (session insert block)
- Modify: `tracking/src/app/api/touch/route.ts:168-194` (session update block)

**Step 1: Add geo fields to new session insert**

In `tracking/src/app/api/touch/route.ts`, the session insert at line 122 never includes `country` or `city`. The `x-vercel-ip-country` and `x-vercel-ip-city` headers are only read later in the forwarding block (line 232). Move the header reads earlier and include them in the insert.

Find the line (around line 72):
```typescript
const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
const ipHash = await hashString(ip)
```

Add immediately after:
```typescript
const country = request.headers.get('x-vercel-ip-country') || null
const city = request.headers.get('x-vercel-ip-city') || null
```

Then in the session insert object (after `ip_hash: ipHash,` around line 160), add:
```typescript
country,
city,
```

Remove the duplicate geo reads from the forwarding block (lines 232-233) and use the variables defined earlier.

**Step 2: Add geo fields to session update path**

In the `hasTouchData` update block (around line 170), the geo is never updated either. For returning visitors, we should update geo if it was previously null:

After the existing `updateData` construction, add:
```typescript
if (country && !updateData.country) {
    // We can't check existing value without a read, so just set it
    // Supabase will handle the update
}
```

Actually, simpler approach: always include country/city in updates since they come from request headers and are always current:
```typescript
// Add to SessionTouchUpdate interface:
country?: string | null
city?: string | null

// Add to updateData construction:
if (country) updateData.country = country
if (city) updateData.city = city
```

**Step 3: Update the forwarding block to reuse variables**

In the forwarding block (around line 231), replace:
```typescript
const country = request.headers.get('x-vercel-ip-country')
const city = request.headers.get('x-vercel-ip-city')
```
With: (just remove these lines — they now use the variables from earlier)

**Step 4: Commit**

```bash
cd /Users/artemhorvatsky/Documents/dev/tracking
git add src/app/api/touch/route.ts
git commit -m "fix: populate country and city fields on session creation from Vercel geo headers"
```

---

### Task 2: Fix fbc cookie storage gap (Issue #4)

**Root cause:** When a user arrives with `fbclid` in the URL, the `fbc` value is correctly built and stored on NEW sessions. But the 96% drop-off suggests many sessions are created WITHOUT fbclid (organic first visit), and when the user LATER clicks a Facebook ad, the update path may not store fbc properly.

Additionally, the `_fbc` cookie is set on the tracking domain (`track.haloagency.cz`), but the Meta Pixel sets its own `_fbc` on the client domain. These are separate cookies. The tracking system should also read `fbc` from the request body (passed by t.js) to handle cases where the cookie doesn't round-trip.

**Files:**
- Modify: `tracking/public/t.js:19-33` (add fbc/fbp reading from cookies)
- Modify: `tracking/src/app/api/touch/route.ts:45-48` (improve fbc capture)

**Step 1: Have t.js read _fbc and _fbp cookies from the client domain and send them**

In `tracking/public/t.js`, the data object (lines 19-33) captures `fbclid` from URL params but does NOT read the `_fbc` or `_fbp` cookies that the Meta Pixel may have set on the client domain. Add cookie reading:

After line 31 (`landing: window.location.pathname + window.location.search,`), add:
```javascript
fbc: getCookie('_fbc'),
fbp: getCookie('_fbp'),
```

Move the `getCookie` function definition (currently at line 100) BEFORE the data object construction (before line 19), since it's now needed earlier.

**Step 2: Use client-sent fbc/fbp as fallback in touch endpoint**

In `tracking/src/app/api/touch/route.ts`, modify the fbc/fbp resolution to also consider values sent from the client:

Replace lines 45-48:
```typescript
const existingFbc = request.cookies.get('_fbc')?.value || null
const existingFbp = request.cookies.get('_fbp')?.value || null
const fbc = buildFacebookClickCookie(existingFbc, body.fbclid)
const fbp = buildFacebookBrowserCookie(existingFbp)
```

With:
```typescript
const existingFbc = request.cookies.get('_fbc')?.value || body.fbc || null
const existingFbp = request.cookies.get('_fbp')?.value || body.fbp || null
const fbc = buildFacebookClickCookie(existingFbc, body.fbclid)
const fbp = buildFacebookBrowserCookie(existingFbp)
```

This way, if the Meta Pixel set `_fbc` on the client domain (e.g., `catcafeprague.com`), t.js reads it and sends it in the body, and the tracking server uses it as a fallback when the cross-domain cookie isn't available.

**Step 3: Commit**

```bash
cd /Users/artemhorvatsky/Documents/dev/tracking
git add public/t.js src/app/api/touch/route.ts
git commit -m "fix: read _fbc/_fbp cookies from client domain to improve Facebook match rate"
```

---

### Task 3: Fix growth_plan_form session tracking (Issue #1)

**Root cause analysis:** The `haloSessionId` state in `GrowthPlanMagnetForm.tsx` starts as `""`. If `waitForHaloTrack()` resolves (either HaloTrack loaded or 5s timeout) but `getHaloTrackSessionId()` returns `""`, the form sends `session_id: ""`. In the HaloTrack lead webhook, `normalizeLead` does `session_id: body.session_id || body.halo_session_id` — empty string is falsy, so session_id becomes undefined. Then attribution matching skips all 3 priorities → `match_type: 'none'`.

Possible triggers: (a) consent='denied' so t.js returns `session_id: null`, (b) t.js fetch failed (CORS, network), (c) 5s timeout expired.

**Two-part fix:**
1. Make the form more resilient to missing session_id (try cookie as fallback)
2. Ensure t.js consent detection doesn't default to 'denied' when consent hasn't been set yet

**Files:**
- Modify: `haloagency-website/lib/halotrack.ts:39-44` (improve session ID retrieval)
- Modify: `haloagency-website/components/sections/GrowthPlanMagnetForm.tsx:65-69` (add retry/fallback)
- Modify: `tracking/public/t.js:36-51` (fix consent detection edge case)

**Step 1: Improve getHaloTrackSessionId with cookie fallback**

In `haloagency-website/lib/halotrack.ts`, replace `getHaloTrackSessionId`:

```typescript
export function getHaloTrackSessionId(): string {
    if (typeof window === 'undefined') return '';

    // Priority 1: HaloTrack object (set after /api/touch response)
    if (window.HaloTrack?.getSessionId?.()) {
        const sid = window.HaloTrack.getSessionId();
        if (sid) return sid;
    }

    // Priority 2: _halo cookie (set by tracking server)
    const match = document.cookie.match(/(^| )_halo=([^;]+)/);
    if (match?.[2]) return match[2];

    return '';
}
```

**Step 2: Add a retry in the form's useEffect**

In `GrowthPlanMagnetForm.tsx`, the current useEffect fires once on mount. If the session_id is still empty after the first attempt, retry after a short delay:

Replace lines 65-69:
```typescript
useEffect(() => {
    const getSession = async () => {
        await waitForHaloTrack();
        let sid = getHaloTrackSessionId();

        // Retry once after 2s if still empty (script may still be loading)
        if (!sid) {
            await new Promise(r => setTimeout(r, 2000));
            sid = getHaloTrackSessionId();
        }

        if (sid) setHaloSessionId(sid);
    };
    getSession();
}, []);
```

**Step 3: Fix consent default in t.js**

In `tracking/public/t.js`, the consent detection (lines 36-51) falls through to `consent = 'unknown'` when no CMP is detected AND `halo_cookie_consent` is not in localStorage. This is correct — 'unknown' allows session creation.

However, if `halo_cookie_consent` exists but `parsed.analytics` is `false` (user explicitly denied), consent becomes 'denied' and `session_id: null` is returned. This is also correct behavior.

The real issue may be that the consent banner hasn't been interacted with yet, but the default consent state in `haloagency-website/lib/consent.ts` saves `analytics: true` by default via GTM Consent Mode v2 — BUT this default is only in GTM, not in localStorage. So `halo_cookie_consent` doesn't exist in localStorage until the user clicks the banner.

In that case, t.js falls through to `consent = 'unknown'`, which is fine — the touch endpoint creates a session for 'unknown'. So this path should work.

The most likely cause for the 6 growth_plan leads is: the t.js fetch to `/api/touch` failed silently (CORS, network, ad blocker), so `window.HaloTrack` was never set, and the 5s timeout resolved with no session.

**Verify**: Check that `track.haloagency.cz` is in the CORS allowlist and responds to the haloagency.cz domain properly. The middleware currently allows `https://www.haloagency.cz` and `https://haloagency.cz` — confirm the actual production domain matches one of these exactly.

**Step 4: Commit**

```bash
cd /Users/artemhorvatsky/Documents/dev/haloagency-website
git add lib/halotrack.ts components/sections/GrowthPlanMagnetForm.tsx
git commit -m "fix: improve HaloTrack session ID capture with cookie fallback and retry"
```

---

### Task 4: Fix CatCafe bookings never sent to Google via HaloTrack (Issue #3)

**Root cause:** The HaloTrack lead webhook at `tracking/src/app/api/webhook/lead/route.ts:238` checks `settings.google?.measurement_id && settings.google?.api_secret` from the `clients` table. If the catcafe client row in the `clients` table doesn't have Google credentials in its `settings` JSONB column, forwarding is skipped.

Note: The catcafe booking route (`catcafe/app/api/booking/route.ts:197`) ALSO sends to GA4 directly via `sendGA4Event()`. But this direct send uses the catcafe app's own env vars, not HaloTrack's. The `sent_to_google` flag in the HaloTrack leads table tracks whether HaloTrack forwarded it — and it never does because HaloTrack doesn't have the Google creds.

**Two-part fix:**
1. **Database fix**: Add Google credentials to the catcafe client's settings in the Supabase `clients` table
2. **Code fix**: The catcafe booking route doesn't pass `lead_value` to HaloTrack, which means Google forwarding sends value=0

**Files:**
- Supabase `clients` table: update catcafe client's settings JSONB
- Modify: `catcafe/app/api/booking/route.ts:150-177` (add lead_value to HaloTrack payload)

**Step 1: Update Supabase clients table with Google credentials**

Run this SQL in the Supabase SQL editor for the HaloTrack project:

```sql
-- First, check current settings for the catcafe client
SELECT client_id, settings FROM clients WHERE client_id = '<CATCAFE_CLIENT_ID>';

-- Update with Google credentials
UPDATE clients
SET settings = settings || '{
    "google": {
        "measurement_id": "<GA4_MEASUREMENT_ID>",
        "api_secret": "<GA4_API_SECRET>"
    }
}'::jsonb
WHERE client_id = '<CATCAFE_CLIENT_ID>';
```

The actual values should come from the catcafe project's environment:
- `GA4_MEASUREMENT_ID` from catcafe `.env.local`
- `GA4_API_SECRET` from catcafe `.env.local`

**Step 2: Add lead_value to catcafe HaloTrack payload**

In `catcafe/app/api/booking/route.ts`, the HaloTrack payload (lines 150-177) is missing `lead_value`. Add it:

Find the halotrackPayload object and add after `consent_given: true,`:
```typescript
lead_value: Number(guests) * 150,
currency: "CZK",
```

**Step 3: Commit**

```bash
cd /Users/artemhorvatsky/Documents/projects/catcafe/website/catcafe-prague
git add app/api/booking/route.ts
git commit -m "fix: add lead_value to HaloTrack payload for proper conversion value tracking"
```

---

## Phase 2: Signal Quality Improvements (Issues #4, #6)

### Task 5: Reduce dark sessions — capture referrer earlier (Issue #6)

**Root cause:** 37% of sessions have neither `ft_source` nor `ft_referrer`. The `t.js` script sends `document.referrer` but by the time `afterInteractive` fires, the referrer may be empty on some navigations (e.g., JS redirects, meta refreshes, some Safari behaviors).

**Files:**
- Modify: `tracking/public/t.js` (capture referrer at script parse time, before async operations)

**Step 1: Move referrer capture to synchronous script top**

In `tracking/public/t.js`, `document.referrer` is already captured at script parse time (line 30: `referrer: document.referrer || null`), which is correct. The referrer should be available at this point.

The 37% dark rate is likely legitimate direct traffic + privacy browsers + ad blockers. However, we can improve by also checking `performance.getEntries()` for the navigation type:

After line 32 (`page_title: document.title,`), add:
```javascript
navigation_type: (typeof PerformanceNavigationTiming !== 'undefined' &&
    performance.getEntriesByType('navigation')[0])
    ? performance.getEntriesByType('navigation')[0].type
    : null,
```

This helps distinguish between truly direct traffic (`navigate` with no referrer) vs. reloads, back/forward, and prerender — useful for debugging the dark session rate.

**Step 2: Commit**

```bash
cd /Users/artemhorvatsky/Documents/dev/tracking
git add public/t.js
git commit -m "feat: send navigation_type to help diagnose dark sessions"
```

---

### Task 6: Fix trackFormEvent missing protocol in URL (HaloAgency website)

**Files:**
- Modify: `haloagency-website/lib/halotrack.ts:133`

**Step 1: Fix the trackFormEvent URL**

The `trackFormEvent` function at line 133 builds the URL as:
```typescript
await fetch(`${process.env.NEXT_PUBLIC_HALOTRACK_DOMAIN}/api/event`, {
```

This is missing the protocol (`https://`). It should be:
```typescript
await fetch(`https://${process.env.NEXT_PUBLIC_HALOTRACK_DOMAIN}/api/event`, {
```

**Step 2: Commit**

```bash
cd /Users/artemhorvatsky/Documents/dev/haloagency-website
git add lib/halotrack.ts
git commit -m "fix: add missing https protocol to HaloTrack event API URL"
```

---

## Phase 3: Configuration & Process Fixes (Issue #7)

### Task 7: Document UTM standard for Facebook campaigns (Issue #7)

This is NOT a code fix. It requires updating all Meta ad campaigns to use consistent `utm_medium=paid_social`.

**Action items (manual):**
1. Audit all active Meta ad campaigns in Ads Manager
2. Change `utm_medium` to `paid_social` on every campaign URL template
3. For future campaigns, use this UTM template:
   ```
   ?utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}
   ```
4. Optionally, add a normalization step in `tracking/src/app/api/touch/route.ts` to auto-correct known variations:

**Files:**
- Modify: `tracking/src/app/api/touch/route.ts` (optional normalization)

**Step 1: Add UTM medium normalization (optional)**

After inferring source/medium (around line 95), add normalization:

```typescript
// Normalize known UTM medium variations
if (inferredSource === 'facebook' || inferredSource === 'fb' || inferredSource === 'meta') {
    inferredSource = 'facebook'
    if (inferredMedium === 'cpc' || inferredMedium === 'paid' || inferredMedium === 'social') {
        inferredMedium = 'paid_social'
    }
}
```

**Step 2: Commit**

```bash
cd /Users/artemhorvatsky/Documents/dev/tracking
git add src/app/api/touch/route.ts
git commit -m "fix: normalize Facebook UTM medium variations to paid_social"
```

---

## Phase 4: Backfill & Verification

### Task 8: Backfill fbc for existing sessions with fbclid

After deploying Task 2, existing sessions still have NULL fbc despite having fbclid. Run a one-time SQL backfill:

```sql
-- Backfill fbc from fbclid where fbc is NULL
UPDATE sessions
SET fbc = 'fb.1.' || EXTRACT(EPOCH FROM created_at)::bigint || '.' || fbclid
WHERE fbclid IS NOT NULL
  AND fbc IS NULL;
```

### Task 9: Verify fixes post-deployment

After deploying all changes:

1. **Test growth_plan_form**: Submit a test lead on haloagency.cz → check HaloTrack leads table for session_id and match_type
2. **Test catcafe booking**: Submit a test booking → check HaloTrack leads table for sent_to_google = true
3. **Test fbc capture**: Visit catcafe with `?fbclid=test123` → check sessions table for fbc value
4. **Test country**: Visit any tracked page → check sessions table for country field
5. **Test UTM normalization**: Visit with `?utm_source=facebook&utm_medium=cpc` → check sessions table shows `paid_social`

---

## Summary of Changes by Repository

| Repository | Files Modified | Issues Fixed |
|-----------|---------------|-------------|
| **tracking** | `src/app/api/touch/route.ts`, `public/t.js` | #4, #5, #6, #7 |
| **haloagency-website** | `lib/halotrack.ts`, `components/sections/GrowthPlanMagnetForm.tsx` | #1, #2, #6 (trackFormEvent URL) |
| **catcafe** | `app/api/booking/route.ts` | #3 |
| **Supabase** | `clients` table settings | #3 |
| **Meta Ads Manager** | Campaign UTM templates | #7 |

## Priority Order

1. **Task 1** (country/city) — simplest, zero risk
2. **Task 4** (catcafe Google forwarding) — biggest conversion recovery
3. **Task 2** (fbc cookies) — significant signal quality improvement
4. **Task 3** (growth_plan_form sessions) — fixes 13% of leads
5. **Task 6** (trackFormEvent URL) — bug fix found during audit
6. **Task 7** (UTM normalization) — prevents future inconsistency
7. **Task 5** (dark sessions diagnostic) — informational improvement
8. **Task 8** (backfill) — recovers historical data
9. **Task 9** (verification) — confirms all fixes work
