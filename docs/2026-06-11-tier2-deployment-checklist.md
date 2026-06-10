# Tier 2 Deployment Checklist — what YOU need to do

> All 12 Tier 2 tasks are implemented and verified locally (tsc clean, 30/30 tests, production build passes).
> **Nothing is committed or deployed yet.** This file is the step-by-step to get it live.
> Order matters: migration → push → test. Don't skip ahead.

---

## Step 0 — Review & commit (local)

The entire Tier 2 changeset is uncommitted on `main` (~20 modified/new files).

- [ ] Optional but recommended: run `/code-review` in Claude Code on the working tree
- [ ] Commit the changeset (one commit or logical chunks — your call)
- [ ] **Do NOT push yet** — push triggers redeploys of every per-client Vercel project (Step 2)

## Step 1 — Apply the DB migration (Supabase, BEFORE pushing)

Additive and safe to run while old code is live. Open Supabase → SQL Editor → run:

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ga_session_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
```

(Source: `supabase/migrations/add_ga_session_id_and_ip_address.sql`)

Verify:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'sessions'
  AND column_name IN ('ga_session_id', 'ip_address');
-- expect 2 rows
```

- [ ] Migration applied
- [ ] Verification query returns 2 rows

## Step 2 — Push & redeploy

- [ ] `git push` — Vercel auto-deploys **every** HaloTrack project connected to the repo
- [ ] In each Vercel project (haloagency, catcafe, nejbalonky, …): confirm the new deployment went out; if any project has auto-deploy off, redeploy manually **with build cache cleared**
- [ ] CI: check the first GitHub Actions run on `main` is green (`.github/workflows/ci.yml` — tsc + lint (non-blocking) + tests)

> t.js is served by each deployment, so the push also ships the new t.js to every client site automatically — no GTM changes needed.

## Step 3 — Env var check (each Vercel project)

Nothing new is *required*. Confirm existing:

- [ ] `CRON_SECRET` present (cron endpoints 401 without it)
- [ ] `WEBHOOK_SECRET` present (HMAC + legacy auth both derive from it)
- [ ] `N8N_WEBHOOK_URL` — only needed once Step 4 is done; alerts silently skip Telegram until set

## Step 4 — n8n Telegram alerting (one-time, ~15 min)

1. Import `docs/n8n-halotrack-volume-alert.json` into n8n
2. Set Telegram bot token + chat ID in the Telegram node
3. Activate the workflow, copy the **production** webhook URL
4. Add `N8N_WEBHOOK_URL=<url>` to **every** HaloTrack Vercel project → redeploy each

- [ ] Done — the new `dead_queue_items` (critical) and `stuck_pending_retries` (warning) alert types flow through the same webhook

## Step 5 — Re-run SOP Phase 4 tests on ONE client

Use the updated SOP v5.1 (Phase 4). Recommended client: nejbalonky (exercises the WooCommerce path). New checks beyond the usual ones:

- [ ] Test 1: `sessions.ga_session_id` non-null after a visit where GA4 loaded (epoch-seconds format)
- [ ] Test 1: `sessions.ip_address` non-null
- [ ] Test 3: Meta Events Manager shows **IP address** in Lead/Purchase match parameters
- [ ] Test 3: only ONE PageView per visit (server-side PageView forwarding is removed)
- [ ] Test 4: GA4 conversion NOT "Unassigned" (Realtime immediately; standard reports 24–48 h)
- [ ] Test 5/6: forwarding queue clean, Signal Health green

## Step 6 — Client-site follow-ups (starter repo / Next.js sites — when you next touch them)

None of these block the deploy; leads fall back gracefully meanwhile.

- [ ] **Visitor IP on leads:** form handlers pass the visitor's `ip_address` in the lead webhook body (from the site's own request headers). Until then, leads use the matched session's stored IP.
- [ ] **Consent event:** custom banner dispatches `window.dispatchEvent(new CustomEvent('halo:consent-changed'))` after saving `halo_cookie_consent`, so t.js picks up consent granted after page load. (Cookiebot/CookieYes sites: nothing to do — auto-detected.)
- [ ] **HMAC signing:** webhook senders add `x-halo-timestamp` + `x-halo-signature: hex(hmac_sha256("${ts}.${rawBody}", WEBHOOK_SECRET))`. Legacy `x-webhook-secret` keeps working until all senders are migrated.

## Step 7 — WooCommerce clients

**Nothing required.** The plugin keeps working unchanged: legacy webhook auth is still accepted, the order normalizer contract (`meta_data._halo_session`) is untouched, and the new t.js makes the checkout session-field injection *more* reliable (HaloTrack stub exists before any network call).

Shipped with Tier 2 (already in this changeset, deploy via Steps 0–2):
- ✅ Order-level visitor IP: the plugin's `customer_ip` (Shopify: `browser_ip`) is now forwarded to Meta CAPI as `client_ip_address`, preferred over the session's first-touch IP. Server-side — benefits all plugin versions, no WP re-upload needed.
- ✅ Plugin **v1.0.1**: `halotrack:ready` listener moved to `window` (where t.js dispatches it). Zip rebuilt at `integrations/woocommerce/halotrack-woocommerce.zip` — it was stale (April build) and now matches the current plugin including the Blocks/HPOS hooks.

Remaining, optional:
- [ ] Re-upload plugin v1.0.1 to client WP sites opportunistically (v1.0.0 works via its fallbacks — not urgent)
- [ ] Upgrade plugin to HMAC-signed webhooks (PHP `hash_hmac('sha256', "$ts.$body", $secret)`) next time it's touched

## Step 8 — 24–48 h after deploy

- [ ] Signal Health green on all client dashboards
- [ ] `SELECT status, COUNT(*) FROM forwarding_queue GROUP BY status;` — no growing `pending`/`dead`
- [ ] GA4 standard reports attribute server-side conversions to real sources (not Unassigned)
- [ ] Meta Events Manager match quality improved (IP + E.164 phone now in match params)

## Already done (no action)

- ✅ SOP bumped to **v5.1** in the Obsidian vault (`SOP_HaloTrack_Setup.md`) — new migration step, DB-driven CORS (Step 2.6 needs no deploy), extended Phase 4 tests, HMAC + Journey + CI sections, updated troubleshooting
- ✅ Tier 2 plan checklist marked complete (`docs/plans/2026-06-10-tier2-implementation.md`)
