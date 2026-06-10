# Tier 3 — Profit Feedback Loop

> **Goal:** Stop optimizing ads for form-fills. Feed *qualified* and *won* (with real deal value) back to Meta and Google so the algorithms bid on revenue, and put ROAS per campaign on the dashboard so losing ads die early.
>
> Two independently shippable phases. Phase A is the money lever; Phase B makes it visible.
> Format follows `2026-06-10-tier2-implementation.md`. Existing infra this builds on: `updateLeadStatus(leadId, status, dealValue?)` in `src/app/actions/dashboard.ts:403`, `leads.deal_value` + `status` columns (already migrated), click IDs in `leads.attribution_data`, forwarding queue + retry cron, `ad_spend` table + `importAdSpend()` in `src/app/actions/spend.ts`, CSV exports in `src/app/actions/export.ts`.

---

## Phase A — Won/Qualified feedback to ad platforms

- [ ] **A1. Migration — stage forwarding tracking** — `supabase/migrations/add_stage_forwarding.sql`: `leads.qualified_forwarded_at TIMESTAMPTZ`, `leads.won_forwarded_at TIMESTAMPTZ` (dedup guards — never send the same stage twice); extend `forwarding_queue` CHECK to allow `event_type = 'lead_stage'`; update `schema.sql` + `ForwardingQueue` type in `src/types/index.ts`.

- [ ] **A2. Meta stage event builder** — `src/lib/forwarding/facebook-stage.ts`: `sendStageToFacebook({ session, lead, stage, dealValue, ... })`. Custom events `LeadQualified` / `LeadWon`, `action_source: 'system_generated'` (Meta's CRM-event convention), `value` = `deal_value` (fallback `lead_value`), deterministic `event_id` = `lead_<external_id>_<stage>`, `event_time` = now (status change IS the conversion moment — always inside CAPI's 7-day window even when the click is months old; Meta attributes via stored fbc). User data: hashed email/phone (reuse `shared.ts`, E.164), fbc/fbp from `attribution_data.click_ids`, session `ip_address` + `user_agent` when matched. Returns `ForwardingResult` with `payload` for the queue.

- [ ] **A3. GA4 stage events** — `src/lib/forwarding/google-stage.ts`: MP events `lead_qualified` / `lead_won` with stored `ga_client_id`, `value`/`currency`, `engagement_time_msec`. No new credentials — uses existing `measurement_id`/`api_secret`. Honest limitation: attribution is user-scoped (GA4 last-click across sessions), not gclid-precise — that's what A6 is for. Skip send when `ga_client_id` is null.

- [ ] **A4. Hook into `updateLeadStatus`** — after the status update succeeds and the new status is `qualified` or `won` and the matching `*_forwarded_at` is null: load client settings + matched session, fire A2/A3, stamp `*_forwarded_at`, enqueue to `forwarding_queue` (`event_type: 'lead_stage'`) on failure. Never let a forwarding error fail the dashboard action — log with request id, return success.

- [ ] **A5. Retry cron — handle `lead_stage`** — `src/app/api/cron/retry-queue/route.ts`: on successful replay of a `lead_stage` item, stamp `qualified_forwarded_at`/`won_forwarded_at` (parse stage from `event_id` suffix) instead of flipping `sent_to_facebook` — that flag must keep meaning "the original Lead event was sent".

- [ ] **A6. Won-leads CSV for Google Ads** — extend `exportGoogleLeads()` in `src/app/actions/export.ts` with a `wonOnly` option: gclid + `Conversion Name = lead_won` + `status_updated_at` as conversion time + `deal_value` as value. This is the gclid-precise Google path (offline click conversion upload) until/unless the Ads API integration lands. Add a "Won only" toggle to `ExportConversions.tsx`.

- [ ] **A7. UI: deal value prompt + stage-sent indicators** — `LeadsManager.tsx`: when marking a lead `won`, require/prompt for deal value (value drives bidding — a won lead without value teaches the algorithm nothing); show small sent-state icons for stage events (same pattern as `RecentOrders` Facebook/Google icons), backed by the `*_forwarded_at` columns.

- [ ] **A8. Tests** — `src/lib/forwarding/stage.test.ts` following `payloads.test.ts` style: event names, deterministic event_ids, hashed em/ph, value passthrough, `action_source: 'system_generated'`, ga_client_id skip-when-null, dedup (second call with `*_forwarded_at` set sends nothing). `tsc` + full suite green.

## Phase B — Spend in, ROAS out

- [ ] **B1. Spend entry UI** — new `src/app/dashboard/components/SpendManager.tsx` (manual row entry + CSV upload) wired to the existing `importAdSpend()`/`getAdSpend()` actions in `spend.ts`. CSV columns: date, source, medium, campaign, spend. This unblocks ROAS for **both** platforms today with zero API credentials.

- [ ] **B2. Meta spend auto-pull cron** — `src/app/api/cron/pull-spend/route.ts` (daily, add to `vercel.json`): per active client with `settings.facebook.ad_account_id` + `settings.facebook.insights_token`, pull yesterday's spend per campaign from the Marketing API insights endpoint, upsert into `ad_spend` (`source='facebook'`, `medium='paid_social'`, campaign = campaign name). Campaign names join against UTMs — works because the SOP UTM template already uses `{{campaign.name}}`. Note: the CAPI dataset token usually lacks `ads_read`; collect a separate insights token (manual steps).

- [ ] **B3. ROAS server action** — `src/app/actions/roas.ts`: `getRoasByCampaign(clientId, from, to)` joining `ad_spend` against revenue (orders `total_amount` for ecommerce; leads `deal_value` where `status='won'` for lead clients; both for combined) grouped by source/medium/campaign → spend, revenue, ROAS, CPL, cost-per-won-lead, won rate.

- [ ] **B4. ROAS dashboard panel** — `src/app/dashboard/components/RoasPanel.tsx` + wire into `DashboardClient` (date-range aware, like LeadsBySource): campaign table sorted by spend, ROAS color-coded (≥3 green / 1–3 yellow / <1 red — adjustable per client later), "no spend data" empty state pointing to SpendManager. Unmatched campaign names (spend with no revenue row or vice versa) shown explicitly — that's a UTM hygiene alarm, not noise to hide.

- [ ] **B5. Tests + CI** — ROAS math unit tests (joins, division-by-zero, currency assumption single-currency-per-client), spend upsert idempotency. Suite green.

## Deploy order

1. Apply migration A1 in Supabase (additive, safe before code).
2. Ship Phase A → mark one real lead `qualified`/`won` → verify in Meta Events Manager (Test Events) + GA4 Realtime; check `forwarding_queue` stays clean.
3. **Meta, per client:** create Custom Conversions on `LeadQualified` and `LeadWon` → switch lead campaigns' optimization goal to the qualified/won custom conversion once it has ~10+ events/week (below that, keep optimizing on Lead and use won data for manual budget decisions).
4. **GA4, per client:** mark `lead_won` as a key event → import it in Google Ads (Goals → Conversions → Import → GA4) with value.
5. Ship Phase B; backfill `ad_spend` 30 days via CSV so ROAS has history on day one.
6. SOP bump to v5.2: stage-event verification in Phase 4, Custom Conversion setup step in Phase 5, ROAS panel in Phase 6.

## Manual steps (not doable from this repo)

| Step | Where | What |
|---|---|---|
| Custom Conversions | Meta Ads Manager, per client | Create on `LeadQualified` + `LeadWon`; switch campaign optimization when volume allows |
| Key event + import | GA4 + Google Ads, per client | `lead_won` as key event → import to Google Ads with value |
| Insights token + ad account ID | Meta Business Suite, per client | Token with `ads_read` for B2; store in `clients.settings.facebook` (SQL update, no deploy) |
| Won-leads upload | Google Ads, monthly per client | Upload the A6 CSV (Goals → Offline conversions) until/unless Ads API automation is built |
| Google Ads API (optional, later) | Google Ads | Developer token application (basic access) — only worth it once monthly CSV uploads become annoying |
| Workflow habit | You | Statuses must actually get set — the loop is only as good as the CRM hygiene. 2 min/day in the leads manager. |
