# Tier 2 Implementation — Correctness + Trust

> Source: `docs/2026-06-10-halotrack-gap-analysis.md` (§4, Tier 2). Each task below maps to a section there.

## Task checklist

- [x] **T1. Plan doc + DB migrations** — this file; `supabase/migrations/add_ga_session_id_and_ip_address.sql` (sessions.ga_session_id, sessions.ip_address); schema.sql updated
- [x] **T2. Shared forwarding helpers + Graph API v25.0** — `src/lib/forwarding/shared.ts` (sha256, phone normalization incl. E.164, FB_GRAPH_VERSION); de-duplicate the copies in facebook*.ts / google*.ts
- [x] **T3. GA4 fixes** — t.js parses `_ga_<container>` cookie (GS1 + GS2 formats) → `ga_session_id` stored on session → sent as MP `session_id` param; E.164 phone hashing for Google; `engagement_time_msec`; drop no-op `gclid` event param
- [x] **T4. Real IPs to Meta** — store visitor IP on sessions; Purchase CAPI sends `session.ip_address` not `ip_hash`; lead webhook IP fallback = body → session (the old `x-forwarded-for` fallback sent the *website server's* IP)
- [x] **T5. Remove server-side PageView forwarding** — browser pixel/GTM already fires PageView; server copies can't dedupe (timestamp event_id) and double-count on both platforms
- [x] **T6. t.js resilience** — HaloTrack stub defined before fetch (cookie-based getSessionId + queued identify/track), retry with backoff + keepalive, `halo:consent-changed` listener
- [x] **T7. Dead-item + stuck-pending alerts** — added to volume-alert cron payload
- [x] **T8. DB-driven CORS** — middleware allowlist from active clients' domains, 5-min cache; new client = SQL insert, no deploy
- [x] **T9. HMAC webhook signatures** — `x-halo-signature` + `x-halo-timestamp` (5-min window), legacy `x-webhook-secret` still accepted
- [x] **T10. Correlation IDs** — request_id in touch/webhook error paths and queue entries
- [x] **T11. Vitest + GitHub Actions CI** — payload snapshot tests (E.164, real IP, ga_session_id, event IDs), match waterfall, backoff, HMAC; CI runs tsc + lint + tests
- [x] **T12. Journey view from touchpoints** — `src/app/actions/journey.ts` + `JourneyTimeline.tsx`, wired into RecentOrders (session-matched orders) and RecentLeads (leads with session_id) expanders; lazy-loads on expand

## Deploy order (after code review)

1. **Apply the migration** to the shared Supabase DB (additive, safe before code deploy):
   `supabase/migrations/add_ga_session_id_and_ip_address.sql`
2. Push to GitHub → redeploy **every** per-client HaloTrack Vercel project (no build cache).
3. Re-run SOP Phase 4 tests on one client; new checks:
   - `sessions.ga_session_id` non-null after a visit where GA4 loaded (format: epoch seconds)
   - `sessions.ip_address` non-null
   - GA4 Realtime: `generate_lead_v2` attributed to the session source (not Unassigned) — allow 24–48 h for standard reports
   - Meta Events Manager: Lead/Purchase show IP in match parameters

## Manual steps (not doable from this repo)

| Step | Where | What |
|---|---|---|
| Telegram alerting | n8n | Import `docs/n8n-halotrack-volume-alert.json`, set bot token + chat ID, copy webhook URL → `N8N_WEBHOOK_URL` env var on every HaloTrack deployment (SOP §6.3). The new `dead_queue_items` / `stuck_pending` alert types flow through the same webhook. |
| Visitor IP on leads | client sites (starter repo) | Form handler should pass the visitor's `ip_address` in the lead webhook body (from the site's own request headers). Until then, leads fall back to the matched session's stored IP. |
| Consent event | client sites (starter repo) | Custom banner should `window.dispatchEvent(new CustomEvent('halo:consent-changed'))` after saving `halo_cookie_consent`, so t.js picks up consent granted after page load. |
| HMAC signing | client sites (starter repo) | Webhook senders can add `x-halo-timestamp` + `x-halo-signature: hex(hmac_sha256("${ts}.${rawBody}", WEBHOOK_SECRET))`. Legacy header keeps working meanwhile. |
| Sentry | Vercel + Sentry | Optional follow-up; correlation IDs (T10) work without it. |
| SOP update | SOP vault | Bump SOP to v4.1: add `ga_session_id`/`ip_address` checks to Phase 4 Test 1, note HMAC option, note CORS no longer needs a code deploy (Step 2.6 becomes "verify domain row exists"). |
