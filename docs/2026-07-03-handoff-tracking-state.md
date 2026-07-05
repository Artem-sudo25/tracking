# HaloTrack — Session Handoff (2026-07-03)

> **Purpose:** full state-of-the-world for continuing work in a new chat. Repo: `/Users/artemhorvatsky/Documents/dev/tracking` (branch `main`). The user is a marketer (not a developer) running HaloTrack, a first-party tracking system for client sites: shared Supabase DB, one Vercel deployment per client (`CLIENT_ID` env var), `t.js` client script, `/api/touch` session capture, order/lead webhooks forwarding server-side to Meta CAPI + GA4 Measurement Protocol, dashboard with journeys/ROAS.

---

## 1. The story so far (short version)

1. **June 11, 2026** — big "Tier 2" release shipped in one commit (`a3c8672` "v_fable_5"): gbraid/wbraid groundwork, HMAC webhook auth, journey/touchpoint dedup, t.js resilience, consent-denial propagation, GA4 `ga_session_id` stitching, real-IP capture, and more.
2. **Right after it**, the client **nejbalonky.cz** (WooCommerce e-commerce) saw Google Ads conversions collapse (days showing `0.06 conversions / Kč17k cost-per-conv` while HaloTrack showed real orders). GA4 totals stayed fine but purchases leaked into **Unassigned** instead of `google/cpc` — and Google Ads only imports the `google/cpc` slice.
3. Long debugging saga (multiple wrong theories, honest resets). Along the way we **built an offline Google Ads conversion upload** (secured CSV endpoint that Google Ads pulls daily) and a **server-GA4 kill-switch**.
4. **Root cause found by full-commit audit:** the June 11 commit **REMOVED `gclid` from the server-side GA4 sends** (`src/lib/forwarding/google.ts` purchase + `src/lib/forwarding/google-lead.ts` lead), replacing it with fragile `ga_session_id` stitching. Without the gclid anchor, server events lose acquisition context → Unassigned → invisible to Google Ads.
5. **Diagnostic rollback (mid-June):** nejbalonky's **Vercel deployment was rolled back to the pre-June-11 build** (commit `c69a91a`, Apr 20, "ecom_dash"). **VERDICT (confirmed by user 2026-07-03): the rollback FIXED it.** Conversions work like before. Root cause = the June 11 code, not Google-side changes.
6. **User decision: keep nejbalonky on the rolled-back April build for now.** Do not touch it.

## 2. Current state — exact

### Git (`main`)
| Commit | Date | Contents |
|---|---|---|
| `8c121e5` consent_columns | Jun 14 | Per-row consent columns in export CSV |
| `c42b0d9` upload_v2 | Jun 14 | `.csv` URL rewrite + HTTP Basic Auth for Google's scheduled pull |
| `7eafd04` kill_server+manual_upload | Jun 14 | Phase 1 offline upload (gbraid/wbraid capture, export endpoint) + `SKIP_SERVER_GA4_PURCHASE` env kill-switch |
| `63b678b` updt / `a3c8672` v_fable_5 | Jun 11 | The Tier 2 release **containing the gclid regression** |
| `c69a91a` ecom_dash | Apr 20 | **The "last known good" build nejbalonky now runs** |

### Uncommitted in working tree (5 files, from Jun 15 — SHOULD BE COMMITTED FIRST)
`src/lib/google-conversions.ts`, its test, `src/app/actions/export.ts`, `src/app/api/export/google-conversions/route.ts`, the plan doc — the **"click-ID-only" revert**: removed hashed Email/Phone columns from the offline CSV because the Google Ads action type ("track conversions from clicks") has **no email/phone mapping field**; email-only rows just produced upload errors (14 errors on first run). Export now requires gclid/gbraid/wbraid. Consent columns kept. Verified: 55/55 tests, tsc clean, build OK.

### Deployments
- **nejbalonky** (`cdn.nejbalonky.cz`): pinned to the **April build**. Server-side GA4 (pageview + purchase **with gclid**) active again; kill-switch env var is inert there (old code doesn't check it). ⚠️ Two accepted temporary trade-offs: (a) the April build re-opens the **consent leak** (denied-after-load users still forwarded — pre-Tier2 behavior, non-compliant, fix later by moving to fixed main); (b) the **offline-upload endpoint doesn't exist** on the April build → the scheduled Google Ads HTTPS pull ("Manual_upload_HaloTrack", daily 00:00–01:00 GMT+2) is 404ing or should be paused in Google Ads.
- **Two lead-gen Next.js sites** (existing): unaffected, running whatever they ran before.
- ⚠️ **CRITICAL before any `git push`: check whether nejbalonky's Vercel project auto-deploys from `main`.** If yes, a push would overwrite the rollback. Freeze it first (Vercel → nejbalonky project → Settings → Git → disconnect or Ignored Build Step).

### Google Ads (nejbalonky account)
- Conversion graveyard cleaned; GA4 (web) purchase import = **Primary**.
- Offline action `HaloTrack Purchase` created = **Secondary** (observation only), fed by scheduled HTTPS pull — currently broken/paused due to rollback (see above). First-ever run imported 26 rows successfully, 14 errors (the click-id-less rows, since fixed by click-ID-only revert).
- **Anti-inflation rule (critical, learned the hard way): exactly ONE Primary purchase action, ever.** Google does NOT dedup across separate conversion actions.

## 3. The fix to build on `main` (next code task)

**Restore `gclid` to both server-side GA4 sends, KEEPING `ga_session_id`** (strictly better than both April and June versions):
- `src/lib/forwarding/google.ts` (purchase) and `src/lib/forwarding/google-lead.ts` (lead): in `events[0].params`, add back `...(session.gclid ? { gclid: session.gclid } : {})` alongside the existing `...(session.ga_session_id ? { session_id: session.ga_session_id } : {})`.
- April also sent `session_id: session.session_id` (HaloTrack UUID) — do NOT restore that; keep the June `ga_session_id` version.
- Optional/later: June 11 also deleted the server-side GA4/Meta **pageview** forwarding from `/api/touch` (`google-pageview.ts`, `facebook-pageview.ts` removed). April build has it. If stitching still looks weak after the gclid fix, consider restoring the GA4 pageview.
- Keep everything else from Tier 2 (consent propagation is CORRECT/compliant; Meta improvements are good).

**Sequence:** commit the 5 uncommitted files → build gclid fix → verify (vitest, tsc, build with dummy env vars — see memory/build notes) → freeze nejbalonky auto-deploy → push.

## 4. New lead-gen website (the active task)

User is onboarding a **new lead-generation site**. Decisions made:
- **Setup = the proven April-style architecture on FIXED main:** browser GA4 tag + **server-side GA4** (`generate_lead_v2` with gclid + hashed email/phone) + **Meta CAPI**. **NO offline upload** for this site (user explicitly doesn't want it now).
- Google Ads gets conversions via **GA4 key event import** (mark `generate_lead_v2` as key event in GA4, import into Google Ads, ONE Primary).
- Deploy from `main` **after** the gclid fix, so the site gets Tier 2 benefits (HMAC auth, journey dedup, t.js resilience, gbraid/wbraid capture) without the regression.
- Onboarding steps (full SOP: `SOP_HaloTrack_Setup.md` v5.1 in Obsidian vault `/Users/artemhorvatsky/Documents/projects/nejbalonky/obsdian/`): Supabase `clients` row (`client_type: 'leads'`, domain, `settings.google.measurement_id`/`api_secret` for server GA4, `settings.facebook` pixel+token) → new Vercel project from repo with `CLIENT_ID`, `SITE_DOMAIN`, Supabase vars, `WEBHOOK_SECRET`, `CRON_SECRET` → DNS CNAME for tracking subdomain → `t.js` snippet on site → form handler posts leads to `/api/webhook/lead` (HMAC or legacy `x-webhook-secret`).

## 5. Key decisions log (don't relitigate)
- **Consent policy:** upload/forward `granted` + `unknown`; **`denied` = never** (GDPR; gclid itself is personal data; rejected sending denied even hypothetically).
- **Offline CSV is click-ID-only** (gclid > gbraid > wbraid). No email/phone columns — action type can't map them. Per-row consent columns: granted→GRANTED, unknown→UNSPECIFIED, both Google fields same value.
- **Skipped:** IP address + session-attributes CSV fields (no matching gain, GDPR cost); Enhanced Conversions for Leads separate action (~43 orders/wk, not worth it); C5 Google Ads API push.
- **Single-day Google Ads numbers are meaningless at ~1 conv/day** — always judge on 7-day rolling windows; Ads dates conversions by CLICK day, GA4 by conversion day.
- Google's scheduled HTTPS pull requires URL ending `.csv` + Basic Auth (password = `GOOGLE_EXPORT_KEY`, username ignored); browser test: `https://cdn.nejbalonky.cz/api/export/google-conversions.csv?key=<KEY>`.
- Vercel builds need dummy env vars (empty `.env.local`): `NEXT_PUBLIC_SUPABASE_URL=https://dummy.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy SUPABASE_SERVICE_KEY=dummy CLIENT_ID=client_dummy SITE_DOMAIN=example.com GOOGLE_EXPORT_KEY=dummy npm run build`.

## 6. Open items checklist
- [ ] Commit the 5 uncommitted click-ID-only files
- [ ] Build the gclid-restore fix (Section 3)
- [ ] Freeze nejbalonky Vercel auto-deploy BEFORE pushing main
- [ ] Pause (or verify paused) the Google Ads scheduled HTTPS pull while nejbalonky runs the April build
- [ ] Onboard the new lead-gen site from fixed main (Section 4)
- [ ] LATER (nejbalonky): move from April build to fixed main (restores compliance + Tier 2 + offline endpoint), then reactivate the scheduled pull; keep offline action Secondary; observe-first before any Primary flip
- [ ] Separate open issue: Merchant Center ~76% item-ID mismatch (Woo variation IDs vs parent product_id) — never investigated
- [ ] Tier 3 plan exists, not started: `docs/plans/2026-06-11-tier3-profit-loop.md`

## 7. Key paths
- Plan (full history of the Google Ads task): `docs/plans/2026-06-13-google-ads-offline-conversions.md`
- Tier 2 checklist: `docs/2026-06-11-tier2-deployment-checklist.md`
- Forwarding: `src/lib/forwarding/{google,google-lead,facebook,facebook-lead}.ts`
- Export: `src/lib/google-conversions.ts`, `src/app/api/export/google-conversions/route.ts`, `src/app/actions/export.ts`
- Capture: `public/t.js`, `src/app/api/touch/route.ts`; webhooks: `src/app/api/webhook/{order,lead}/route.ts`
- Claude memory (persists on this machine): `~/.claude/projects/-Users-artemhorvatsky-Documents-dev-tracking/memory/`

---

## 📋 PROMPT TO PASTE INTO THE NEW CHAT

```
Hi! I'm continuing work on my HaloTrack tracking system. Before doing anything, read the handoff document at docs/2026-07-03-handoff-tracking-state.md — it has the full history, current state, and decisions. Please follow it strictly (don't relitigate the decisions log).

Quick context: I'm a marketer, not a developer. My e-commerce client nejbalonky is ROLLED BACK to the April build on Vercel and working fine — do not touch it. The June 11 release broke Google Ads conversions by removing gclid from the server-side GA4 sends; the fix (restore gclid alongside ga_session_id in google.ts and google-lead.ts) is designed but NOT built yet.

What I want to do now:
1. Commit the 5 uncommitted files (click-ID-only export revert).
2. Build and verify the gclid-restore fix on main.
3. Remind me to freeze nejbalonky's Vercel auto-deploy before any push.
4. Then walk me through onboarding my NEW lead-gen website from the fixed main (browser GA4 + server-side GA4 + Meta CAPI, NO offline upload), step by step — I'll do the Vercel/DNS/Supabase clicks, you do the code and tell me exactly what to click.

Start by reading the handoff doc and confirming you understand the current state.
```
