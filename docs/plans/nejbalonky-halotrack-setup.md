# HaloTrack Setup — Nej Balonky (nejbalonky.cz)

**Date:** 2026-04-17
**Client ID:** `client_nejbalonky`
**HaloTrack subdomain:** `cdn.nejbalonky.cz`
**Platform:** WooCommerce on Hostinger
**Ad platforms:** Meta + Google Ads
**Currency:** CZK
**Consent:** Cookiebot (Consent Mode v2 — already working)

---

## Step 1 — Check schema migrations in Supabase

Open Supabase → SQL Editor and run:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name = 'ga_client_id';

SELECT column_name FROM information_schema.columns
WHERE table_name = 'forwarding_queue'
ORDER BY ordinal_position;
```

- If `ga_client_id` returns a row AND `forwarding_queue` returns 12 rows → **skip to Step 2**
- If either is missing → run the full migration block from SOP Step 2.1

---

## Step 2 — Add client to Supabase

```sql
INSERT INTO clients (client_id, name, domain, user_id, active)
VALUES ('client_nejbalonky', 'Nej Balonky', 'nejbalonky.cz', null, true);
```

Then immediately add credentials (fill in real values before running):

```sql
UPDATE clients
SET settings = jsonb_build_object(
  'currency', 'CZK',
  'timezone', 'Europe/Prague',
  'facebook', jsonb_build_object(
    'pixel_id', 'YOUR_PIXEL_ID',
    'access_token', 'YOUR_META_ACCESS_TOKEN',
    'test_event_code', 'YOUR_TEST_CODE'
  ),
  'google', jsonb_build_object(
    'measurement_id', 'G-XXXXXXXXXX',
    'api_secret', 'YOUR_GA4_API_SECRET'
  )
)
WHERE client_id = 'client_nejbalonky';
```

Verify — all columns must be non-null:

```sql
SELECT client_id, name, domain,
       settings->'facebook'->>'pixel_id' AS fb_pixel,
       settings->'facebook'->>'access_token' IS NOT NULL AS fb_token_set,
       settings->'google'->>'measurement_id' AS ga4_id,
       settings->'google'->>'api_secret' IS NOT NULL AS ga4_secret_set
FROM clients WHERE client_id = 'client_nejbalonky';
```

---

## Step 3 — Create dashboard login

1. Supabase → Authentication → Users → Add user
2. Enter email + password for client
3. Copy the UUID from the user list

```sql
UPDATE clients SET user_id = 'PASTE-UUID-HERE'
WHERE client_id = 'client_nejbalonky';
```

---

## Step 4 — Add domain to CORS

In HaloTrack repo → `src/middleware.ts`, add to `ALLOWED_ORIGINS`:

```ts
'https://www.nejbalonky.cz',
'https://nejbalonky.cz',
```

Commit + push. This redeploys all existing HaloTrack projects — safe to do.

---

## Step 5 — Deploy new Vercel project

1. Vercel → Add New Project → import HaloTrack GitHub repo
2. Set environment variables (Production + Preview):

```
NEXT_PUBLIC_SUPABASE_URL        = (same as other deployments)
NEXT_PUBLIC_SUPABASE_ANON_KEY   = (same)
SUPABASE_SERVICE_KEY            = (same)
CLIENT_ID                       = client_nejbalonky
SITE_DOMAIN                     = nejbalonky.cz
WEBHOOK_SECRET                  = (generate: openssl rand -hex 32 — save this, needed for WP plugin)
CRON_SECRET                     = (same value across all HaloTrack deployments)
```

3. Deploy → note the `.vercel.app` URL for testing before DNS propagates

---

## Step 6 — Custom subdomain + DNS

1. Vercel → this project → Settings → Domains → Add: `cdn.nejbalonky.cz`
2. Hostinger DNS panel for `nejbalonky.cz` → add record:

```
Type:   CNAME
Name:   cdn
Value:  cname.vercel-dns.com
TTL:    3600
```

3. Wait for DNS propagation (5–30 min on Hostinger)
4. Visit `https://cdn.nejbalonky.cz` — should load without SSL errors

---

## Step 7 — Gate check

```sql
SELECT client_id, name, domain,
       settings->'facebook'->>'pixel_id' AS fb_pixel,
       settings->'google'->>'measurement_id' AS ga4_id,
       user_id
FROM clients WHERE client_id = 'client_nejbalonky';
```

Then open `https://cdn.nejbalonky.cz/dashboard` → log in → Signal Health panel visible (blank is expected — no events yet).

---

## Step 8 — Install WooCommerce plugin

Plugin file is at:
`tracking/integrations/woocommerce/halotrack-woocommerce.php`

1. WordPress admin → Plugins → Add New → Upload Plugin
2. Upload `halotrack-woocommerce.php`
3. Activate
4. Settings → HaloTrack → fill in:
   - HaloTrack URL: `https://cdn.nejbalonky.cz`
   - Webhook Secret: (value from Step 5 `WEBHOOK_SECRET`)

---

## Step 9 — Load t.js via GTM

In GTM → Tags → New → Custom HTML:

```html
<script src="https://cdn.nejbalonky.cz/t.js" async></script>
```

Trigger: All Pages. Publish container.

---

## Step 10 — Remove Stape

1. WordPress → Plugins → deactivate Stape plugin
2. Re-enable GTM4WP plugin (already configured)
3. Cancel Stape subscription

Only do this after Signal Health shows green for 48h.

---

## Credentials to collect before starting

| Credential | Value | Got it? |
|---|---|---|
| Meta Pixel ID | | [ ] |
| Meta Access Token | | [ ] |
| Meta Test Event Code | | [ ] |
| GA4 Measurement ID | | [ ] |
| GA4 API Secret | | [ ] |
| Google Ads ID | | [ ] |
| WEBHOOK_SECRET (generate) | | [ ] |
| Dashboard login email/password | | [ ] |
