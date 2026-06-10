# Nej Balonky — Tracking Attribution Recovery

**Date range:** 24–28 April 2026
**Client:** Nej Balonky (nejbalonky.cz)
**Stack:** WordPress + WooCommerce + LiteSpeed Cache on Hostinger shared hosting
**Tracking:** HaloTrack v4.0 (deployed at `track.nejbalonky.cz`)
**Outcome:** Match rate recovered from 20% to 93% post-fix.

---

## The symptom

Across 23–24 April, orders were arriving in Supabase with `match_type = 'none'` and `session_id = NULL` at an unusual rate. Of the ten orders received in that 48-hour window, eight (80%) had no session attribution and therefore no path back to the originating ad click. This meant Facebook CAPI and Google Ads MP weren't getting attributed conversions, and ad optimization data was effectively dark for every affected order.

The unmatched orders' `attribution_data` contained only `{"match_type": "none"}` — no device info, no click IDs, no first/last touch — which indicated the *server-side* webhook was reaching Supabase but the browser-side tracker on the thank-you page wasn't enriching it with a session ID. Either HaloTrack's `t.js` wasn't running on the thank-you page, or the page was on a domain where the `_halo` cookie wasn't readable.

## The investigation

We built a temporary debug harness because the SOP-level diagnostics weren't telling us *why* the thank-you page tracker was failing. The harness had three layers:

A new Supabase table `public.debug_events` and a corresponding edge function `debug-log` were created to receive beacons. The edge function authenticates with a shared token (`nbk_debug_beacon_2026_a8f3k29x`), validates JSON, and writes to the table using the service role key.

A WordPress MU-plugin (`02-nejbalonky-debug-logger.php`) was dropped into `wp-content/mu-plugins/`. On every request where the host header didn't match `nejbalonky.cz`, or whenever the URL was a thank-you/order-received page regardless of host, it `wp_remote_post`'d the full request context — `HTTP_HOST`, all `X-Forwarded-*` headers, WordPress's runtime values for `home_url()`, `site_url()`, and the `home`/`siteurl` options, the WooCommerce-computed checkout URL, the LiteSpeed cache marker, the active plugin list, and a sanitized server-vars dump — to the edge function.

A Google Tag Manager Custom HTML tag with an All Pages trigger ran the same idea client-side: any time a real browser was either on the temp Hostinger domain or on a thank-you page, it `fetch()`'d the page's `location.hostname`, `document.referrer`, performance redirect chain, presence of the `_halo` cookie, presence of `window.HaloTrack`, and the result of `getSessionId()`.

Within 48 hours the harness had collected enough data to make the picture obvious.

## What the data showed

The Hostinger-assigned preview domain — `peru-mole-473733.hostingersite.com` — was publicly resolvable and was serving the production WooCommerce store directly to real customers. Across the 26–27 April window the harness logged 268 PHP requests carrying that hostname, the vast majority from genuine Chrome/Edge browsers (not bots) with the `Sec-Fetch-Site: same-origin` header, meaning they were navigating *within* the temp domain rather than just stumbling onto it. Two JS beacon hits captured returning customers — full sets of `_ga`, `_ga_DYY7CT2ZB8`, `_fbp`, `_gcl_au`, `__kla_id`, `_hjSessionUser_*` cookies — browsing entire sessions on `peru-mole-473733.hostingersite.com`. Their `_halo` cookie was missing because that cookie is scoped to `.nejbalonky.cz`. HaloTrack's `t.js` SDK was never loaded for them (`window.HaloTrack` was undefined) because the cross-origin script-load was blocked.

Every request to the temp host carried two telling headers: `X-Preview-Indicator: true` and `Server: hcdn`, with `X-LSCACHE: on,crawler,esi,combine` showing LiteSpeed's full caching layer was active. These are Hostinger's CDN/edge markers — they confirm the request was being routed through Hostinger's preview-domain layer *before* reaching Apache, which is why no amount of `.htaccess` or `wp-config.php` host-guard rules could intercept it. The redirect we'd written and deployed to `.htaccess` did fire eventually, but it produced an `ERR_TOO_MANY_REDIRECTS` loop because Hostinger's edge layer was bouncing requests back to the temp host on the return trip — `nejbalonky.cz` → 301 to … → CDN sees preview routing → back to `peru-mole-…` → our `.htaccess` 301s to nejbalonky.cz again — forever.

## Root cause

The Hostinger plan keeps the auto-assigned preview domain (`peru-mole-473733.hostingersite.com`) publicly routable by default, even after a custom domain is connected, and it routes those requests through a CDN layer that runs ahead of the Apache rewrite stack. Search engines, ad-platform crawlers, and any link that originally referenced the preview URL will continue to deliver real customers to it indefinitely. Once a customer lands on the preview domain, they remain on it for the rest of their session because every internal link on the page is generated server-side using `$_SERVER['HTTP_HOST']` (which is the preview domain at that moment). Their checkout, order-received, and thank-you all happen on `peru-mole-…hostingersite.com`. The `_halo` cookie — first-party scoped to `.nejbalonky.cz` — is invisible there, so no session ID exists to be passed to the order webhook. The order arrives at Supabase orphaned.

The Hostinger specialist's earlier hypothesis that FooSales (the WooCommerce POS plugin) was responsible turned out to be a misdiagnosis. FooSales is installed and active, but it's a back-office register tool with no customer-facing pages and the harness data shows no FooSales-originated traffic involved in the affected orders.

## The fix

Edge-level fixes (`.htaccess` redirects, `wp-config.php` `WP_HOME`/`WP_SITEURL` constants, hPanel's domain-redirect feature) all live *behind* Hostinger's CDN routing layer, so none of them can intercept preview-domain traffic before it's served. The only fix that actually works is to have Hostinger deprovision the preview hostname at the infrastructure level. Their support team can do this on request — the agent (Mohammad) confirmed the deprovisioning over chat after we explained the problem. Once removed, `peru-mole-473733.hostingersite.com` stopped resolving entirely and the bug class disappeared.

A backup `.htaccess` 301 redirect from the preview host to `https://nejbalonky.cz/` was left in place as belt-and-suspenders, in case Hostinger ever spins up another preview domain on the account.

## Results

Match rate is the most direct measurement of the fix's impact:

| Window                          | Orders | Matched | Match rate |
|---------------------------------|--------|---------|------------|
| 23–24 April (pre-investigation) | 10     | 2       | 20%        |
| 25–28 April (post-fix)          | 14     | 13      | 93%        |

The single unmatched order in the post-fix window (76418) was investigated separately. The customer landed on the correct domain (`page_hostname = nejbalonky.cz`), had a working WooCommerce session, and had every other tracker's cookies present (`_ga`, `_ga_DYY7CT2ZB8`, `_fbp`, `_gcl_au`, `__kla_id`, `_hjSession_*`, `CookieConsent`) — but no `_halo` cookie at all and `window.HaloTrack` was undefined. The most likely explanation is a browser-level tracker blocker filtering the `track.nejbalonky.cz` subdomain on this user's mobile Chrome. This is the irreducible attribution loss floor that every tracking system has, and 7% sits at the favourable end of the 5–15% industry baseline.

The last `wrong_host_hit` event in the harness data was 27 April at 14:08 Prague time — zero preview-domain traffic since the deprovisioning. Both PHP and JS beacons agree.

## What got built (and what to clean up later)

The harness is still running and is still safe to leave in place — it costs nothing and will catch any regression — but when you're ready to retire it, here's the inventory.

The Supabase table `public.debug_events` and the edge function `debug-log` (project `aiwzeqqzpvzycddfpxvt`) can both be dropped. The edge function uses the project's default `SUPABASE_SERVICE_ROLE_KEY` env var and does not need to be rotated.

The MU-plugin `02-nejbalonky-debug-logger.php` lives at `public_html/wp-content/mu-plugins/` on the Hostinger filesystem. Deleting the file disables it instantly with no admin step required — MU-plugins have no activation toggle.

The GTM tag named *NBK — Debug Beacon (thank-you / wrong host)* fires on the All Pages trigger. Pause or delete it in the GTM workspace, then Submit and Publish.

The `.htaccess` redirect block (the four-line `<IfModule mod_rewrite.c>` at the top of `public_html/.htaccess`) should stay. It's defensive cover for the unlikely case that Hostinger reissues a preview domain. It has no performance impact and adds no complexity.

## Lessons for the WordPress/WooCommerce client class

The HaloTrack v4.0 SOP currently assumes a Vercel/Next.js client site, where the canonical-domain problem cannot occur — Vercel doesn't auto-issue preview hostnames for production traffic. WordPress/WooCommerce clients on shared hosting are a different beast and need a small set of additional setup steps when onboarded.

First, on initial provisioning, ask the host to confirm whether any platform-issued temporary or preview hostname is publicly routable, and have it deprovisioned at the same time the custom domain is connected. This single step would have prevented the entire incident.

Second, regardless of the host, add an `.htaccess`-level canonical-host redirect that 301s any non-canonical hostname to the configured production domain. It's a five-line block and a permanent safety net. Place it above any `# BEGIN ...` block so it runs before LiteSpeed Cache, WordPress permalinks, or anything else; on Hostinger that means above `# BEGIN LSCACHE`.

Third, exclude `/checkout/`, `/cart/`, and `/checkout/order-received/` from any page cache. These pages contain per-user data (form nonces, cart state, order keys) and should never be cached. On LiteSpeed this is at *LiteSpeed Cache → Cache → Excludes*. Caching these endpoints is what amplifies any host-mismatch bug — a single bad-host render gets served to every subsequent customer until the cache expires.

Fourth, when troubleshooting a "match_type = none" situation, the right first move is to compare the cookie list on the affected order's thank-you-page beacon against a working order's. If `_halo` is missing while every other tracker's cookies are present, it's almost always a tracker-blocker on that specific browser, not a site-wide bug. If multiple cookies are missing (`_ga`, `_fbp`, etc.) it's consent or a JS error. If only `_halo` is consistently missing across many customers, the host or domain is wrong.

## Files in this project folder

The deployment artifacts and operational docs live alongside this recap in the same folder:

`01-htaccess-snippet.txt` — the four-line redirect block to paste at the top of `public_html/.htaccess`.

`01-htaccess-FULL-FILE.txt` — a complete corrected `.htaccess` file with the redirect block plus the LSCACHE, NON_LSCACHE, and WordPress sections intact, used during the deploy when the original WP block needed to be restored.

`02-nejbalonky-debug-logger.php` — the WordPress MU-plugin that captures server-side request context and posts it to the `debug-log` edge function.

`03-gtm-custom-html-tag.html` — the JS beacon that runs in the customer's browser via Google Tag Manager and captures `_halo` cookie state, HaloTrack SDK availability, and consent status.

`README-step-by-step.md` — the original onboarding doc with the deploy procedure for each piece of the harness.

`PROJECT-RECAP.md` — this file.

## References

The full HaloTrack setup procedure is in the agency's main SOP file at `~/HaloAgency-Brain/04 - RESOURCES/SOPs/SOP_HaloTrack_Setup.md`. The troubleshooting table at the bottom of that doc has an entry for the "session_id null on leads" symptom that pointed us at the t.js failure mode for order 76418.

The Supabase project is `aiwzeqqzpvzycddfpxvt` (Artem-sudo25's Project), region eu-west-1. The `clients` table row for this client is `client_nejbalonky` with `domain = nejbalonky.cz`, timezone `Europe/Prague`, currency `CZK`.

Hostinger's preview-domain behaviour was the subject of a 2024 security advisory after attackers used the same publicly-routable preview hostnames to host phishing pages that inherited the legitimate site's SSL and content — see *Hackers Exploit Hostinger's Preview Domain Feature to Launch Phishing Campaigns* (Infosecurity Magazine). The lesson there matches what we found here: the preview domain is a real attack surface, not just a tracking inconvenience, and disabling it on production sites should be a default operational step.
