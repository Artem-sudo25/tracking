# New Client Tracking Setup Guide

Complete step-by-step guide for setting up tracking on a new client website using the Hello Starter Pack + HaloTrack.

**Assumes:**
- You already have HaloTrack deployed on Vercel with a Supabase database
- The client website is built on the Hello Starter Pack (Next.js) and deployed on Vercel
- You have access to the client's Google Ads, GA4, and Meta Business Suite accounts

---

## Overview of What We're Setting Up

| Tool | Purpose |
|------|---------|
| Google Tag Manager (GTM) | Loads GA4 tag, manages all browser-side tags |
| Google Analytics 4 (GA4) | Analytics + source of truth for conversion reporting |
| GA4 Measurement Protocol | Server-side duplicate of key events — bypasses ad blockers |
| Google Ads | Ad campaign management — imports conversions from GA4 |
| HaloTrack | First-party attribution — ties UTM/gclid/fbclid to each lead |
| Facebook Pixel + CAPI | Ad targeting + server-side conversion reporting to Meta |
| Cookie Banner + Consent | GDPR compliance — already built into the starter pack |

---

## Part 1: HaloTrack — Add New Client

### Step 1: Add client record to Supabase

Go to your **Supabase dashboard → SQL Editor** and run:

```sql
INSERT INTO clients (client_id, name, domain, user_id, active)
VALUES ('client_CLIENTNAME', 'Client Display Name', 'clientdomain.com', null, true);
```

Replace `CLIENTNAME`, `Client Display Name`, and `clientdomain.com` with the actual values.

### Step 2: Create dashboard login

1. Go to **Supabase → Authentication → Users → Add user → Create new user**
2. Enter an email and password for the client
3. After creating, **copy the UUID** from the user list

### Step 3: Link the user to the client

```sql
UPDATE clients SET user_id = 'PASTE-UUID-HERE' WHERE client_id = 'client_CLIENTNAME';
```

### Step 4: Add the client domain to CORS — CRITICAL

Open `/src/middleware.ts` in the HaloTrack repo and add the client's domain to `ALLOWED_ORIGINS`:

```ts
const ALLOWED_ORIGINS = [
  'https://www.haloagency.cz',
  'https://haloagency.cz',
  'https://www.clientdomain.com',   // ← add these two lines
  'https://clientdomain.com',        // ← for the new client
  'http://localhost:3000',
  'http://localhost:3001'
]
```

**If you skip this step, HaloTrack will be blocked by CORS and won't track anything on the client site.** Push the change and redeploy HaloTrack before moving on.

### Step 5: Deploy a new Vercel project for the client

1. Go to **Vercel → New Project → import the HaloTrack GitHub repo**
2. Add these environment variables (same Supabase credentials as your existing deployment):

```
NEXT_PUBLIC_SUPABASE_URL      = (same as your existing HaloTrack deployment)
NEXT_PUBLIC_SUPABASE_ANON_KEY = (same)
SUPABASE_SERVICE_KEY          = (same)
CLIENT_ID                     = client_CLIENTNAME
SITE_DOMAIN                   = clientdomain.com
WEBHOOK_SECRET                = (generate a strong random string, or reuse existing)
```

3. Deploy → note the Vercel URL (e.g. `halotrack-client.vercel.app`)

### Step 6: Add custom domain (optional but recommended for first-party cookies)

1. In Vercel → the new HaloTrack project → **Settings → Domains → Add**
2. Enter `track.clientdomain.com`
3. In the client's DNS (Vercel or wherever), add:
   ```
   Type:  CNAME
   Name:  track
   Value: cname.vercel-dns.com
   ```
4. Wait for DNS to propagate

---

## Part 2: Google Tag Manager

### Step 1: Create a GTM container

1. Go to **tagmanager.google.com → Create Account**
2. Account name: client's company name
3. Container name: `clientdomain.com`
4. Target platform: **Web**
5. Copy the **Container ID** — looks like `GTM-XXXXXXX`

### Step 2: You'll configure tags inside GTM after GA4 is set up (Part 3)

---

## Part 3: Google Analytics 4

### Step 1: Create a GA4 property

1. Go to **analytics.google.com → Admin → Create Property**
2. Property name: client's business name
3. Set timezone and currency to match the client
4. Create a **Web data stream** → enter the client's domain
5. Copy the **Measurement ID** — looks like `G-XXXXXXXXXX`

### Step 2: Get the Measurement Protocol API secret

1. In GA4 → **Admin → Data Streams → click your stream**
2. Scroll to **Measurement Protocol API secrets → Create**
3. Name it anything (e.g. `server-side`)
4. Copy the **Secret Value**

### Step 3: Add GA4 tag in GTM

1. Go to GTM → **Tags → New**
2. Tag type: **Google Analytics: GA4 Configuration**
3. Measurement ID: paste your `G-XXXXXXXXXX`
4. Trigger: **All Pages**
5. Save and **Publish** the container

---

## Part 4: Google Ads

### Step 1: Link GA4 to Google Ads

1. In **Google Ads → Admin → Linked accounts → Google Analytics**
2. Find the GA4 property → **Link**

### Step 2: Import conversions from GA4

> **Note:** The `generate_lead` event only appears here after it has fired at least once on the live site (i.e. after the first real or test form submission). Come back to this step after the first booking.

1. **Google Ads → Goals → Conversions → Summary → New conversion action**
2. Choose **Import → Google Analytics 4**
3. Select `generate_lead` → Import

### Step 3: Get conversion labels (if running Google Ads campaigns)

For each conversion action you want to track separately:
1. In **Google Ads → Goals → Conversions** click the conversion action
2. Under **Tag setup → Use Google Tag Manager** — copy the **Conversion Label**
3. You'll need these labels for the env vars below

---

## Part 5: Facebook Pixel + Conversions API

### Step 1: Create a dataset (Pixel)

1. Go to **Meta Business Suite → Events Manager → Connect Data Sources → Web**
2. Name it after the client
3. Choose **Conversions API + Meta Pixel** (not just Pixel)
4. Enter the client's domain
5. Copy the **Pixel ID** (a long number)

### Step 2: Generate an access token

1. In **Events Manager → your dataset → Settings**
2. Scroll to **Conversions API → Generate Access Token**
3. Copy the token — keep it secret, never commit to git

### Step 3: Add Facebook credentials to HaloTrack via Supabase

```sql
UPDATE clients
SET settings = jsonb_set(
  settings,
  '{facebook}',
  jsonb_build_object(
    'pixel_id', 'YOUR_PIXEL_ID',
    'access_token', 'YOUR_ACCESS_TOKEN',
    'test_event_code', 'YOUR_TEST_CODE'
  )
)
WHERE client_id = 'client_CLIENTNAME';
```

Get the test event code from **Events Manager → Test Events** tab.

---

## Part 6: Add Environment Variables to the Client Website (Vercel)

Go to **Vercel → client website project → Settings → Environment Variables** and add all of these. Make sure every variable is enabled for **Production**.

```
# Google Tag Manager
NEXT_PUBLIC_GOOGLE_TAG_ID               = GTM-XXXXXXX

# Google Ads (only if running ads campaigns)
NEXT_PUBLIC_GOOGLE_ADS_ID               = AW-XXXXXXXXXX
NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL = (booking completed label)
NEXT_PUBLIC_GOOGLE_ADS_BOOKING_START_LABEL  = (booking started label)
NEXT_PUBLIC_GOOGLE_ADS_BOOKING_CTA_LABEL    = (book CTA click label)
NEXT_PUBLIC_GOOGLE_ADS_CONTACT_CTA_LABEL    = (contact CTA click label)

# GA4 server-side (Measurement Protocol)
GA4_MEASUREMENT_ID                      = G-XXXXXXXXXX
GA4_API_SECRET                          = (your API secret)

# HaloTrack
NEXT_PUBLIC_HALOTRACK_DOMAIN            = track.clientdomain.com
HALOTRACK_WEBHOOK_SECRET                = (your webhook secret)

# Facebook
NEXT_PUBLIC_META_PIXEL_ID               = (your Pixel ID)
META_ACCESS_TOKEN                       = (your access token — server-side only, never NEXT_PUBLIC_)
```

After adding all variables, **redeploy with no build cache** to ensure all `NEXT_PUBLIC_` vars are picked up.

---

## Part 7: Add GA4 Credentials to HaloTrack via Supabase

This enables HaloTrack to also forward server-side pageviews to GA4.

```sql
UPDATE clients
SET settings = jsonb_set(
  settings,
  '{google}',
  jsonb_build_object(
    'measurement_id', 'G-XXXXXXXXXX',
    'api_secret', 'YOUR_API_SECRET'
  )
)
WHERE client_id = 'client_CLIENTNAME';
```

---

## Part 8: Testing

### Test HaloTrack session tracking

1. Clear the `_halo` cookie in **DevTools → Application → Cookies**
2. Visit the site with UTM params:
   ```
   https://clientdomain.com/?utm_source=google&utm_medium=cpc&utm_campaign=test
   ```
3. Open DevTools → Console and run:
   ```javascript
   console.log(window.HaloTrack)
   ```
   Should return `{ sessionId: "...", getSessionId: function, ... }`
4. Check **Supabase → Table Editor → sessions** — new row should appear with UTM data

### Test full booking flow

1. Make a test form submission / booking on the site
2. Check **Supabase → leads** — entry should appear with `session_id` linked
3. Check **Meta Events Manager → Test Events** — `Lead` event should appear
4. Check **GA4 → Realtime** — `generate_lead` event should appear

---

## Part 9: Go Live Cleanup

### Remove Facebook test event code

Once testing is confirmed working, remove the test code so real ad optimization begins:

```sql
UPDATE clients
SET settings = jsonb_set(
  settings,
  '{facebook}',
  jsonb_build_object(
    'pixel_id', settings->'facebook'->>'pixel_id',
    'access_token', settings->'facebook'->>'access_token'
  )
)
WHERE client_id = 'client_CLIENTNAME';
```

### Import GA4 conversions into Google Ads

Now that `generate_lead` has fired, go back to **Google Ads → Goals → Conversions → Import → Google Analytics 4** and import it.

---

## Troubleshooting

### `window.HaloTrack` is undefined
- Check the `_halo` cookie — if it exists from a previous session, the object is set async after the `/api/touch` call. Wait a moment after page load.
- Check Network tab for `t.js` — if it's not loading, the `NEXT_PUBLIC_HALOTRACK_DOMAIN` env var isn't set or the site wasn't redeployed after adding it.
- Make sure you deployed **without build cache** after adding env vars.

### CORS error on `/api/touch`
- The client domain is missing from `ALLOWED_ORIGINS` in HaloTrack's `/src/middleware.ts`.
- Add both `https://clientdomain.com` and `https://www.clientdomain.com`, push, and redeploy HaloTrack.

### Sessions show as direct despite UTM params
- The `_halo` cookie already exists from a previous visit. Delete it and revisit with UTMs.

### GTM tag not firing
- Check **GTM → Preview mode** to verify the GA4 Configuration tag fires on All Pages.
- Make sure the container is **Published** (not just saved).

### `generate_lead` not showing in Google Ads import
- The event hasn't fired yet on the live site. Make a real or test booking first, wait up to 24h for GA4 to register it, then come back to import.

### Facebook events not appearing in Events Manager
- Verify `pixel_id` and `access_token` are correct in Supabase `clients.settings`
- Make sure `consent_given: true` is being passed in the lead webhook
- Use the test event code while debugging — check **Events Manager → Test Events**
