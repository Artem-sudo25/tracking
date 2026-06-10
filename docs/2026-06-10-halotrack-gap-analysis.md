---
title: HaloTrack Gap Analysis — Triple Whale Benchmark
area: Web Dev / Tracking
version: 1.0
date: 2026-06-10
tags: [analysis, halotrack, reliability, roadmap, triple-whale]
related:
  - docs/plans/2026-04-14-tracking-attribution-fixes.md
  - docs/plans/2026-04-16-tier1-reliability.md
---

# HaloTrack Gap Analysis: What's Missing vs Triple Whale-Grade Reliability

> Every claim below cites the file it was verified against. Items marked **[Tier 2]** or **[Tier 3]** appear in the prioritized roadmap at the end.

## 1. Verdict

HaloTrack's architecture is fundamentally sound and already ahead of what most agencies run: true first-party subdomain cookies, server-side forwarding to Meta CAPI and GA4 Measurement Protocol, consent-gated capture, a retry queue with exponential backoff, and a Signal Health panel. The concept is the same as Triple Whale's pixel.

The gap to Triple Whale is **not architecture**. It is three things:

1. **Forwarding correctness details that silently degrade match rates.** Several payloads are subtly wrong (GA4 phone hashing, GA4 session stitching, hashed IPs sent to Meta, undeduplicated PageViews). None of these throw errors — they just quietly reduce how many conversions the ad platforms can match. This is exactly the class of problem Triple Whale's reputation is built on not having.
2. **Engineering reliability.** Zero tests, no CI, no error tracking. On a multi-tenant tracking platform, a regression in a payload builder means silent data loss across *all* clients until a dashboard looks off.
3. **Automated ad-spend ingestion.** The `ad_spend` table is manual. Triple Whale's core value is spend pulled nightly from Meta/Google APIs so ROAS is always real. Manual entry goes stale immediately.

There is also a list of things **not** worth copying from Triple Whale (§6) — at agency scale, correctness and trust beat features.

---

## 2. What's already strong (keep)

| Capability | Evidence |
|---|---|
| First-party tracking subdomain per client, 365-day `_halo` cookie, apex-domain scoped | [`public/t.js`](../public/t.js), [`src/app/api/touch/route.ts`](../src/app/api/touch/route.ts) |
| Consent-aware capture with `anon_events` fallback for denied consent | [`src/app/api/touch/route.ts`](../src/app/api/touch/route.ts) |
| Server-side CAPI/MP forwarding with hashed PII, fbc/fbp, geo | [`src/lib/forwarding/`](../src/lib/forwarding/) |
| 4-tier match waterfall (session → email → phone → customer_id) with `match_type` recorded | [`src/app/api/webhook/order/route.ts`](../src/app/api/webhook/order/route.ts) |
| Deterministic event IDs for orders (`order_{id}`) and leads — browser-pixel dedup works for conversions | [`src/app/api/webhook/order/route.ts:163`](../src/app/api/webhook/order/route.ts), [`src/app/api/webhook/lead/route.ts:174`](../src/app/api/webhook/lead/route.ts) |
| Retry queue with exponential backoff (1m→24h, 6 attempts) + volume-alert cron + Signal Health panel | [`src/lib/forwarding/queue.ts`](../src/lib/forwarding/queue.ts), [`src/app/api/cron/`](../src/app/api/cron/) |
| WooCommerce / Shopify / generic order ingestion, `days_to_convert`, ad-spend-based ROAS | [`src/app/api/webhook/order/route.ts`](../src/app/api/webhook/order/route.ts), [`src/app/actions/dashboard.ts`](../src/app/actions/dashboard.ts) |
| Operational maturity: SOP with verification gates, audit-driven changelog, nejbalonky post-mortem | `nejbalonky-debug/nejbalonky_debug_PROJECT-RECAP.md` |

This is a real foundation. Everything below is about closing the distance from "good setup" to "platform clients can't break and you can't silently regress."

---

## 3. Gap analysis

### A. Forwarding correctness — highest accuracy impact, lowest effort

These are the bugs that cost match rate *today*, on every conversion.

#### A1. GA4 phone hashing is wrong — likely zero phone matches on Google **[Tier 2]**

`normalizePhone()` strips to digits-only before SHA-256:

- [`src/lib/forwarding/google-lead.ts:66-68`](../src/lib/forwarding/google-lead.ts)
- [`src/lib/forwarding/google.ts:65-67`](../src/lib/forwarding/google.ts)

Google requires the phone to be **E.164 format (`+420777123456`) before hashing** — 11–15 digits with a leading `+` ([Google docs](https://developers.google.com/analytics/devguides/collection/ga4/uid-data)). A hash of `420777123456` will never equal Google's hash of `+420777123456`, so `sha256_phone_number` is currently dead weight in every Google payload.

Note the asymmetry: **Meta's** normalization (digits-only with country code) is acceptable, so the same `normalizePhone()` is fine in the Facebook files — as long as numbers include the country code. Czech local numbers submitted as `777 123 456` would fail both platforms; normalization should add `+420`/`420` when the country is known from session geo.

**Fix:** shared `normalizePhoneE164(phone, defaultCountry)` helper; Google gets `+`-prefixed, Meta gets digits.

#### A2. GA4 session stitching is broken — server conversions land as "unassigned" **[Tier 2]**

The MP payloads send `session_id: session.session_id` — HaloTrack's own UUID:

- [`src/lib/forwarding/google-lead.ts:29`](../src/lib/forwarding/google-lead.ts)
- [`src/lib/forwarding/google.ts`](../src/lib/forwarding/google.ts) (purchase — no session param at all)

For an MP event to inherit the session's source/medium, the `session_id` event param must equal GA4's own `ga_session_id` — the value living in the `_ga_<MEASUREMENT_ID>` cookie — and the `client_id` must match too ([Simo Ahava](https://www.simoahava.com/analytics/session-attribution-with-ga4-measurement-protocol/), [Analytics Mania](https://www.analyticsmania.com/post/unassigned-in-google-analytics-4/)). Without it, GA4 has no acquisition context and the conversion reports as **Unassigned**.

`t.js` already captures `_ga` (client_id, [`public/t.js:40-46`](../public/t.js)) but **not** `_ga_<MEASUREMENT_ID>` (session id). The SOP's troubleshooting row "Google Ads counts fewer conversions than HaloTrack" is most likely this bug.

Also: `gclid` as an MP event param ([`google-lead.ts:28`](../src/lib/forwarding/google-lead.ts)) is not a documented attribution mechanism for MP — session stitching is what carries attribution. Harmless, but it isn't doing what it looks like it's doing.

**Fix:** capture the `_ga_*` session cookie in `t.js`, store `ga_session_id` on sessions (one more column), send it as the `session_id` event param. Fall back gracefully when GA4 hasn't loaded.

#### A3. Hashed IP sent to Meta where real IP is required **[Tier 2]**

Order and PageView CAPI payloads send `client_ip_address: session.ip_hash`:

- [`src/lib/forwarding/facebook.ts:30`](../src/lib/forwarding/facebook.ts)
- [`src/lib/forwarding/facebook-pageview.ts:31`](../src/lib/forwarding/facebook-pageview.ts) (the inline comment even acknowledges the doubt)

Meta explicitly requires `client_ip_address` and `client_user_agent` **unhashed**. A SHA-256 string is not a parseable IP, so Meta discards it — losing one of the strongest match keys for orders and pageviews. The lead path is better ([`facebook-lead.ts:64`](../src/lib/forwarding/facebook-lead.ts) uses `lead.ip_address`), **but** that IP falls back to the webhook request's `x-forwarded-for` ([`src/app/api/webhook/lead/route.ts:64-65`](../src/app/api/webhook/lead/route.ts)) — in a server-to-server webhook that's the *client website's server IP*, not the visitor's. Sending Vercel's IP for every lead actively hurts match quality and geo signals.

**Fix:** store the visitor's real IP (or pass it through the webhook body from the client site — update the starter's form handler), keep `ip_hash` for analytics/GDPR-minimization where the raw IP isn't needed. Privacy note: IP forwarded to Meta under consent is standard CAPI practice; document it in the client DPA instead of hashing it into uselessness.

#### A4. Server PageView events can't deduplicate against the browser pixel **[Tier 2]**

Server PageView event ID is `${CLIENT_ID}_pv_${sessionId}_${Date.now()}` ([`src/app/api/touch/route.ts:272`](../src/app/api/touch/route.ts)) — the browser Meta Pixel fires its own PageView with its own ID, so Meta sees **two PageViews per page** with no shared `event_id`. Conversions (Lead/Purchase) are fine because their IDs are deterministic; PageViews inflate event volume and degrade signal quality for optimization/audiences, and Events Manager will nag about deduplication.

Same story on GA4: server sends `page_view` via MP while GTM's GA4 tag sends its own — double pageviews unless one side stops.

**Fix:** either (a) stop sending server-side PageViews (least value of all server events — ad blockers blocking pageviews matters far less than blocked conversions), or (b) have `t.js` generate the event ID and share it with both the browser pixel and `/api/touch`. Option (a) is simpler and what most CAPI gateways default to.

#### A5. Meta Graph API pinned at v18.0 — past its support window **[Tier 2]**

All three Facebook forwarding files hardcode `graph.facebook.com/v18.0` ([`facebook.ts:53`](../src/lib/forwarding/facebook.ts), [`facebook-lead.ts:81`](../src/lib/forwarding/facebook-lead.ts), [`facebook-pageview.ts:42`](../src/lib/forwarding/facebook-pageview.ts)). v18.0 shipped September 2023; Graph API versions are supported ~2 years, and the current version is **v25.0 (February 2026)** ([Meta changelog](https://developers.facebook.com/docs/graph-api/changelog/versions/)). Calls to retired versions get auto-forwarded to the oldest live version — they work until a behavior change breaks them, unannounced.

**Fix:** one shared `FB_GRAPH_VERSION` constant, bump to current, add a calendar reminder (or a Signal Health check on the API response's version headers).

#### A6. No Event Match Quality (EMQ) monitoring **[Tier 3]**

Signal Health approximates match quality via fbc coverage. Meta exposes the real **EMQ score** per event type via the Graph API. Triple Whale surfaces match quality directly; pulling EMQ into the Signal Health panel turns "we think matching is fine" into "Meta says Lead EMQ is 6.2/10."

#### A7. GA4 `client_id` fallback creates phantom users **[Tier 3 — low priority]**

`client_id: session.ga_client_id || session.session_id` ([`google-lead.ts:20`](../src/lib/forwarding/google-lead.ts), [`google.ts:15`](../src/lib/forwarding/google.ts)) — when `ga_client_id` is missing, sending the HaloTrack UUID mints a brand-new GA4 "user" with no history, guaranteed Unassigned. Better than dropping the event, but worth tracking the fallback rate in Signal Health (the `GA Client ID` metric already approximates this).

---

### B. Capture resilience (`t.js`)

Triple Whale's pixel is obsessive about never losing the beacon. `t.js` is currently fire-and-forget.

#### B1. One failed request kills the whole API **[Tier 2]**

`window.HaloTrack` is only created inside the `.then()` of a successful `/api/touch` call ([`public/t.js:74-116`](../public/t.js)). If that one request fails (flaky mobile network, cold-start timeout, transient 500), there is **no retry** and `window.HaloTrack` never exists — so form components can't call `getSessionId()` and the lead degrades to `match_type: email` at best. The `_halo` cookie may exist from a prior visit, but nothing exposes it.

**Fix:** (a) define a minimal `window.HaloTrack` stub *before* the fetch (cookie-based `getSessionId()`, queued `identify`/`track`); (b) retry `/api/touch` once or twice with backoff; (c) use `keepalive: true` so requests survive navigation.

#### B2. No command queue — early calls are lost **[Tier 2, same change as B1]**

Any `HaloTrack.track()` call made before the touch response returns hits `undefined`. Standard pattern (GA, Segment, posthog-js): a stub array that queues calls and replays them on ready. The `halotrack:ready` event exists ([`public/t.js:111`](../public/t.js)) but pushes the burden onto every form integration.

#### B3. No SPA route-change tracking **[Tier 3]**

One pageview per page load. Next.js client-side navigations produce no touchpoints — journey data (the `touchpoints` table) under-counts on your own starter sites.

#### B4. No bot filtering **[Tier 3]**

Nothing filters crawlers/headless traffic at `/api/touch` or on lead webhooks. Bots pollute sessions, skew the Signal Health denominators, and can trigger false volume alerts. A cheap UA + heuristic filter (plus honeypot field on forms) covers most of it.

#### B5. Custom consent banner has no post-load listener **[Tier 2 — affects your own starter sites]**

The CookieYes and Cookiebot paths listen for consent events, but the custom `halo_cookie_consent` path only fires if the localStorage key **already exists at script load** ([`public/t.js:133-137`](../public/t.js)). A first-time visitor who accepts the banner *after* load only gets tracked via the 200ms-delayed `load` fallback — which reads consent before the user has clicked anything, recording `unknown` and never re-checking. First visits from ads are exactly the sessions you can least afford to record without consent (no forwarding happens on `unknown`). Have the starter's banner dispatch an event (e.g. `halo:consent-changed`) that `t.js` listens for, and re-send consent state to update the session.

---

### C. Engineering reliability — the real Triple Whale gap

#### C1. Zero tests, no CI **[Tier 2 — highest leverage item in this document]**

There are no test files and no CI in the repo. For a marketing site that's a judgment call; for a tracking platform it isn't. The failure mode is uniquely bad: a regression doesn't crash anything — it produces well-formed-but-wrong payloads, and you find out weeks later when a client asks why Meta conversions dropped.

The good news: the riskiest logic is already pure functions, trivially testable without mocks:

- Payload builders (every file in [`src/lib/forwarding/`](../src/lib/forwarding/)) — snapshot the exact JSON for a fixture session+lead. The A1–A4 bugs above would all have been caught by payload snapshot tests.
- Match waterfall + platform detection (WooCommerce/Shopify/generic) in the webhook routes
- Backoff schedule in [`src/lib/forwarding/queue.ts`](../src/lib/forwarding/queue.ts)
- `t.js` parsing (`_ga` extraction, consent detection) via jsdom

**Fix:** Vitest + a GitHub Actions workflow (`tsc --noEmit`, lint, test) on every PR. One day of setup, permanent regression floor.

#### C2. No error tracking, no structured logs **[Tier 2]**

Errors are `console.error` + generic `{ error: 'Internal error' }` responses. No Sentry, no correlation IDs, no way to answer "why did this specific lead not forward?" without SQL archaeology. Triple Whale-grade means every dropped event is traceable. Sentry's free tier plus a `request_id` echoed in responses and stored on `forwarding_queue.last_error` gets you 90% of it.

#### C3. Hardcoded CORS allowlist — a code deploy per client **[Tier 2]**

[`src/middleware.ts:3-12`](../src/middleware.ts) hardcodes six origins. Every new client requires editing source, committing, and redeploying (SOP Step 2.6). It's also shared across all per-client deployments, so any client's site can hit any other client's deployment. Move origins to the `clients` table (domain + www variant derived) with an in-memory cache; new client = SQL insert only.

#### C4. Per-client Vercel deployments — config drift by design **[Tier 3]**

Each client gets a full Vercel project with 8 manually-set env vars (SOP Step 2.7). That's N copies of configuration that can drift, N cron schedules, N deployments to update on every fix. The first-party requirement is the *subdomain* (`track.client.com`), not the deployment — one Vercel project can serve many domains, resolving the client from the `Host` header instead of a `CLIENT_ID` env var. This is how every commercial CAPI gateway works. Not urgent at the current client count; becomes the bottleneck around 10+.

---

### D. Security & GDPR

#### D1. Webhook auth is a static shared header **[Tier 2]**

`x-webhook-secret` equality check, no HMAC body signature, no timestamp → replayable forever if the secret leaks (it lives in two places per client: HaloTrack env + client site env). Compare Shopify/Stripe: `HMAC-SHA256(body + timestamp, secret)` with a tolerance window. Cheap to add, keep the old header as a fallback during migration.

#### D2. Ad-platform tokens in plaintext JSONB **[Tier 3]**

Meta access tokens and GA4 API secrets sit unencrypted in `clients.settings`, and RLS is effectively bypassed (always-true service-role policies, per `schema.sql`). Anyone with the Supabase service key — or any SQL injection anywhere — gets every client's ad account tokens. Supabase Vault (or pgsodium column encryption) for `settings.facebook.access_token` and `settings.google.api_secret` is the targeted fix.

#### D3. No data retention policy **[Tier 3]**

Sessions, touchpoints, and `anon_events` accumulate forever; no cleanup job exists. Beyond storage cost, indefinite retention of IP-derived and behavioral data is a GDPR exposure. A monthly cron deleting/aggregating sessions older than e.g. 14 months (covers year-over-year reporting) is enough. The delete-user endpoint anonymizes rather than deletes — that's a defensible position for financial records (orders), just document it as the policy.

---

### E. Attribution depth — product gaps vs Triple Whale

#### E1. Automated ad-spend sync — the biggest product gap **[Tier 3, biggest effort]**

The `ad_spend` table is manual. Triple Whale's entire pitch is: spend flows in nightly from Meta Insights API + Google Ads API, revenue flows in from the pixel, so ROAS/MER/CPA on the dashboard is *current and trustworthy without anyone doing anything*. Manual entry means the dashboard's ROI numbers are only as fresh as the last time someone pasted numbers in — which in practice means stale.

Realistic path: start with **Meta only** (one Insights API call per client per night, campaign-level spend by date — the API is straightforward and your `settings.facebook.access_token` may already carry `ads_read`). Google Ads API has a heavier approval process (developer token); a stopgap is scheduled report exports. Match on the UTM standards already enforced in the SOP (`utm_source=facebook/google` + campaign name).

#### E2. Touchpoints are collected but invisible **[Tier 2 — cheap win]**

The `touchpoints` table records every visit's source/medium/landing per session, but nothing surfaces it. A "journey" expander on each lead/order in the dashboard (Google cpc → direct → facebook paid_social → converted, with dates) is a few queries plus a component — and it's the single most client-impressive feature in this list: it makes the multi-touch reality *visible*, which neither GA4 nor Meta show honestly. Defer actual multi-touch credit models (position-based etc.) until someone asks; first/last-touch toggle plus a visible journey covers agency needs.

#### E3. Post-lead/post-purchase survey **[Tier 3 — cheap differentiator]**

A one-question "How did you hear about us?" on thank-you pages, stored against the lead/order, catches what cookies can't: dark social, word of mouth, podcasts, and iOS-private traffic. Triple Whale sells this as "Post-Purchase Surveys"; for you it's one component in the starter + one column + one dashboard widget, and it triangulates beautifully against click-based attribution.

#### E4. Identity is "most recent session wins" **[Tier 3 — note, don't build yet]**

Email/phone matching picks the most recently updated session — no identity graph linking a person's sessions across devices/browsers. Fine at current scale; becomes worth revisiting only if clients with long, multi-device consideration cycles (B2B) show high `match_type: email` rates with wrong-looking attribution.

---

### F. Ops & monitoring polish — quick wins

| Gap | Detail | Tier |
|---|---|---|
| **Telegram alerting unfinished** | `N8N_WEBHOOK_URL` is unset — volume alerts currently go only to Vercel function logs that nobody reads. The n8n workflow JSON already exists ([`docs/n8n-halotrack-volume-alert.json`](n8n-halotrack-volume-alert.json)); finishing it is an afternoon. An alerting system that doesn't reach a human is a dashboard, not an alerting system. | **Tier 2 — do first** |
| **Dead queue items are silent** | After 6 failed retries an item goes `dead` and waits for someone to run SQL. Add a dead-item check to the volume-alert cron payload so it reaches Telegram. | Tier 2 |
| **No uptime monitoring** | If `track.client.com` is down (DNS, SSL renewal, Vercel incident), nothing notices until volume alerts fire 6h later. A free external pinger (UptimeRobot et al.) on each `/api/touch` closes the loop. | Tier 2 |
| **`nejbalonky-debug/` at repo root** | Valuable post-mortem, wrong place — untracked at root. Move the recap into `docs/post-mortems/`, drop the rest. | Tier 2 |
| **Duplicated helpers across forwarding files** | `sha256()` + `normalizePhone()` are copy-pasted into 5+ files — which is exactly how A1 happens (a fix lands in one copy). Extract to `src/lib/forwarding/shared.ts` as part of the A1 fix. | Tier 2 |

---

## 4. Prioritized roadmap

### Tier 2 — correctness + trust (each item is hours-to-days)

Ordered by (impact ÷ effort):

| # | Item | Impact | Effort |
|---|------|--------|--------|
| 1 | Finish Telegram alerts (`N8N_WEBHOOK_URL`) + dead-item alerts (§F) | High — alerting finally reaches a human | Hours |
| 2 | GA4 fixes: E.164 phones, capture `_ga_*` session cookie → real `ga_session_id` (§A1, §A2) | High — recovers Google attribution that's silently failing now | 1–2 days |
| 3 | Real IPs to Meta; visitor IP through the lead webhook (§A3) | High — restores a top match key | 1 day |
| 4 | Stop server PageView double-fire (or share event IDs) (§A4) | Medium — cleans Meta/GA4 signal | Hours |
| 5 | Bump Graph API to v25.0, centralize version + shared helpers (§A5, §F) | Medium — removes a time bomb | Hours |
| 6 | Vitest payload snapshots + match waterfall tests + GitHub Actions CI (§C1) | High — permanent regression floor; would have caught items 2–4 | 1–2 days |
| 7 | `t.js` resilience: stub-before-fetch, command queue, retry, keepalive; custom-banner consent listener (§B1, §B2, §B5) | High — capture survives flaky networks; consent captured on first visit | 1–2 days |
| 8 | Sentry + request correlation IDs (§C2) | Medium — every dropped event becomes traceable | 1 day |
| 9 | DB-driven CORS allowlist (§C3) | Medium — removes a per-client code deploy | Hours |
| 10 | HMAC webhook signatures (§D1) | Medium — closes replay risk | 1 day |
| 11 | Journey view from `touchpoints` (§E2) | High client-facing value | 1–2 days |

### Tier 3 — product depth (weeks-scale, schedule deliberately)

| Item | Why | Effort |
|------|-----|--------|
| Meta spend sync → `ad_spend` (then Google) (§E1) | The Triple Whale core value; makes ROAS real | 1–2 weeks |
| EMQ score in Signal Health (§A6) | Real match-quality feedback from Meta | Days |
| Post-lead/post-purchase survey (§E3) | Catches dark traffic; cheap differentiator | Days |
| Bot filtering on touch + lead ingestion (§B4) | Cleaner data, fewer false alerts | Days |
| Data retention cron (§D3) | GDPR hygiene + storage | Days |
| Token encryption via Supabase Vault (§D2) | Limits blast radius of any DB compromise | Days |
| SPA route-change tracking (§B3) | Honest journey data on Next.js sites | Days |
| Single-deployment multi-tenancy (Host-header routing) (§C4) | Kills config drift; revisit at ~10 clients | 1–2 weeks |
| Identity graph (§E4) | Only if B2B clients show attribution problems | Defer |

---

## 5. Suggested sequencing

1. **Week 1 — "stop the silent bleeding":** Tier 2 items 1–5. These fix attribution that is wrong *right now* on live clients, and they're all small.
2. **Week 2 — "make it un-regressable":** items 6–8 (tests/CI/Sentry). Do this *before* any Tier 3 feature work — adding spend sync to an untested codebase multiplies risk.
3. **Then:** items 9–11, then Tier 3 starting with Meta spend sync.
4. After Tier 2 item 2 ships, re-run the SOP's Gate/Test queries on each live client and update the SOP to v4.1 (the GA4 testing checklist should add a `ga_session_id` non-null check next to the existing `ga_client_id` one).

## 6. What NOT to copy from Triple Whale

- **ML/data-driven attribution models** — needs orders of magnitude more conversion volume than agency clients produce; at low volume it's noise with extra steps. First/last-touch + visible journeys is more honest.
- **Creative analytics** (ad-level thumbnail dashboards) — Meta's own Ads Manager does this; rebuilding it adds surface area, not trust.
- **Forecasting / LTV prediction** — same volume problem.
- **An "everything" dashboard** — Triple Whale's breadth serves $10M+ stores with full-time media buyers. Your differentiation is the opposite: a small, *correct*, first-party signal layer the client can actually understand. Reliability is the feature.

---

## Related

- SOP: HaloTrack & Full Tracking Stack — New Client Setup (v4.0)
- [`docs/plans/2026-04-14-tracking-attribution-fixes.md`](plans/2026-04-14-tracking-attribution-fixes.md)
- [`docs/plans/2026-04-16-tier1-reliability.md`](plans/2026-04-16-tier1-reliability.md)
- External references used:
  - [GA4: Send user-provided data via Measurement Protocol](https://developers.google.com/analytics/devguides/collection/ga4/uid-data) (E.164 + SHA-256 requirements)
  - [Simo Ahava: Session attribution with GA4 Measurement Protocol](https://www.simoahava.com/analytics/session-attribution-with-ga4-measurement-protocol/)
  - [Analytics Mania: Unassigned traffic in GA4](https://www.analyticsmania.com/post/unassigned-in-google-analytics-4/)
  - [Meta Graph API versions/changelog](https://developers.facebook.com/docs/graph-api/changelog/versions/) (v25.0 current as of Feb 2026)
