# TASK 1 (standalone, top priority) — Automated Google Ads offline conversion upload

> **Not Tier 2, not Tier 3 — this is the priority task.** Goal: the most *precise* way to get conversions into Google Ads, running on autopilot.
>
> **One-line decision:** HaloTrack serves a secured daily CSV of real orders matched to their Google click IDs (gclid/gbraid/wbraid) with exact values; **Google Ads pulls it on a daily schedule.** End-state: this becomes the **Primary** conversion for bidding and GA4 import drops to **Secondary**. **But we get there in stages — see "Rollout strategy" below.**
>
> **Why this is the most precise:** deterministic click→order matching (not GA4's modeled attribution), exact order value, server-side so ad blockers/consent banners can't drop it, single authoritative source so no double-counting. Slower than GA4 (batched daily) — which is fine, you said precision over speed.

---

## ⭐ Rollout strategy (decided 2026-06-14): observe-first

A long debug session (12–14 Jun) showed Google Ads' recent-day numbers looked broken (e.g. 12 Jun: GA4 had real Paid Search purchases, Ads showed `0.06` conversions / `Kč17k` cost-per-conv). Working theory: the **server-side GA4 send** (woken up by the June `ga_session_id` stitching) is corrupting GA4 attribution — purchases leaking to **Unassigned**, which never reaches Google Ads. **Not** fully confirmed (the Unassigned rows may partly be a first-touch-vs-last-touch artifact), so the revert is run as a *reversible test*, not a certainty.

**The agreed plan — do NOT flip the offline action to Primary yet:**

1. **One deploy** ships everything: Phase 1 code (already built) **+ turn OFF the server-side GA4 send** (Part 7, now decoupled — it happens *now*, not after verification).
2. Offline upload goes live as a **Secondary** conversion action (inert for bidding — pure observation). **GA4 import stays Primary.** Exactly one Primary at all times.
3. Enable **Enhanced Conversions** on the offline action even though it's Secondary, so the trial reflects its true potential.
4. **Watch with defined criteria — not "for a while":**
   - **Revert worked?** Within ~3–5 days GA4's Unassigned purchases should shrink, google/cpc should rise, and Ads daily conversions should stop looking like `0.06`. **Rollback trigger:** if GA4 hasn't recovered in ~5 days, flip the server-side GA4 send back ON and re-investigate (row-level check) — it wasn't the cause.
   - **Is offline worth promoting?** Over ~2 weeks compare the offline action vs the GA4 import **over rolling 7-day windows (never single days)**. If offline is consistently *more complete and more stable* → it earns Primary later. If GA4-post-revert is accurate and you're happy → you may never switch, and that's a fine outcome.
5. **Only if step 4 says so:** flip offline → Primary, GA4 → Secondary (the original end-state).

**Lighter alternative if you just want the fix:** do the Part 7 revert *only* and skip the offline-Secondary trial. That undoes June with zero new moving parts. The trial is worth the extra setup only because you want the comparison data to decide about Primary later.

---

## Current state (2026-06-13)

- GA4: one `purchase` key event ✓ (clean). Imported into Google Ads as `NejBalonky.cz – GA4 (web) purchase`, currently **Primary**.
- Google Ads: graveyard of duplicate purchase conversions cleaned up; one GA4 primary left.
- HaloTrack: captures **gclid** on sessions; sends server-side `purchase` to GA4 (MP) + Meta CAPI; powers the dashboard. Has a **manual** Google-conversion CSV export (`src/app/actions/export.ts` → `exportGoogleConversions`): columns = Google Click ID, Conversion Name, Conversion Time, Conversion Value, Conversion Currency, Order ID. Time format already RFC3339 with offset (`formatGoogleTime`).
- **Gaps to fix:** `gbraid`/`wbraid` are never captured or stored (t.js reads only `gclid`; session insert omits them; `sessions.gbraid`/`wbraid` columns exist but stay null). Export is gclid-only and is a server action, not an HTTP endpoint Google Ads can pull. No consent filter on the export.

---

## Target architecture

```
WooCommerce order ──► HaloTrack order webhook ──► orders table
                                                   (gclid/gbraid/wbraid + value, consent)
                                                        │
Google Ads  ◄── daily scheduled HTTPS pull ◄── GET /api/export/google-conversions
 (Import conversion = PRIMARY)                  (rolling 7-day CSV, consent-filtered)

GA4 import (browser+server) ──► Google Ads (Secondary, cross-check only)
```

---

## PART 1 — Code plan (HaloTrack repo)

> ✅ **BUILT & VERIFIED 2026-06-13** (uncommitted). tsc clean, 62/62 tests, production build OK. C1–C4 done **+ Enhanced Conversions (hashed email + phone) now built in** (see C6 below); C5 (API push) intentionally skipped. Remaining for you: deploy + set `GOOGLE_EXPORT_KEY`, then the Google Ads steps in Part 2 (incl. enabling Enhanced conversions for leads).

### C1. Capture gbraid/wbraid end to end
- **`public/t.js`** (~line 79): add `gbraid: params.get('gbraid')` and `wbraid: params.get('wbraid')` to the data object (next to `gclid`).
- **`src/app/api/touch/route.ts`** session insert: add `gbraid: body.gbraid`, `wbraid: body.wbraid` (columns already exist in `schema.sql` sessions — no migration needed). Also add them to the session **update** path if gclid is updated there.
- **`src/app/api/webhook/order/route.ts`** `attribution_data.click_ids`: add `gbraid: session.gbraid`, `wbraid: session.wbraid` alongside the existing `gclid`. (Same for the lead webhook if leads clients will use this.)
- **`src/types/index.ts`**: add `gbraid`/`wbraid` to the click-IDs type and `Session` type.
- Backfill note: existing historical sessions/orders won't have gbraid/wbraid — only fixable going forward.

### C2. Shared CSV builder (gclid + gbraid + wbraid, consent-filtered)
- Refactor the CSV generation out of `exportGoogleConversions` into a pure function reused by both the manual export action and the new endpoint.
- **Columns** (Google Ads offline import schema): `Google Click ID, Conversion Name, Conversion Time, Conversion Value, Conversion Currency` — plus optional `GBRAID`, `WBRAID` columns. Per row, populate whichever of gclid/gbraid/wbraid exists (prefer gclid; if absent, use gbraid; else wbraid). Skip rows with none.
- **Consent filter (compliance — required):** only include orders whose matched session allowed ad storage. Cleanest: stamp a `consent_ok` boolean (or copy `consent_status`) onto the order at webhook time, then filter `consent_status != 'denied'` in the export. Do **not** upload click IDs for consent-denied users (Consent Mode v2 / GDPR).
- Keep `formatGoogleTime` (RFC3339 with offset) — already correct.
- Conversion Name must be **configurable** (defaults to e.g. `HaloTrack Purchase`) and must exactly match the Google Ads Import action name (Part 2).

### C3. Secured GET endpoint Google Ads can pull
- **Create `src/app/api/export/google-conversions/route.ts`** (GET, returns `text/csv`).
- **Rolling window:** default **last 7 days** (`?days=` overridable). Re-serving overlapping days is safe — Google dedups by gclid+conversionName+time — and the window catches late-settling orders so none fall through.
- **Auth (UPDATED 2026-06-14 — Google's importer dictated this):** Google Ads' scheduled HTTPS upload **requires HTTP Basic Auth** (username + password fields, both required) and a URL **ending in `.csv`/`.tsv`** — a `?key=` query URL is rejected ("Unable to read file format"). Implemented: endpoint checks the Basic-Auth **password** against `GOOGLE_EXPORT_KEY` (username ignored), and still accepts `?key=` as a browser-test fallback. The `.csv` URL is a **rewrite in `next.config.ts`** (`/api/export/google-conversions.csv` → the route); query string preserved. Hashed email/phone travel in the Basic-Auth'd body over HTTPS, not in the querystring — good.
- Client scoping: endpoint serves the deployment's own `CLIENT_ID`; ecommerce → orders, leads/bookings → leads (mirror dashboard `client_type` logic).
- Returns the C2 CSV with a `text/csv` content-type and no caching.

### C4. Tests
- Unit-test the C2 builder: gclid present; gbraid-only fallback; wbraid-only fallback; none → skipped; consent-denied → skipped; value/currency/time formatting; conversion-name passthrough. Follow the existing `payloads.test.ts` / `normalize.test.ts` style. `tsc` + suite green.

### C6. Enhanced Conversions — hashed email + phone (⚠️ REVERSED 2026-06-15, see C8)

### C8. Reverted to click-ID-only (DONE 2026-06-15)
- **Why:** the first scheduled upload ran fine (**26 rows imported**) but **14 errored** — all rows with no click id. Root cause: the Google Ads action is the **"track conversions from clicks"** type, which matches on **gclid/gbraid/wbraid/IP/session-attributes only** — its field mapping has **no email/phone target field at all**. So the C6 hashed email/phone columns were unmappable dead weight, and emitting click-id-less (email-only) rows just produced errors.
- **Change:** inclusion logic now **requires a click id** (gclid/gbraid/wbraid); email-only rows are skipped. Removed the `Email`/`Phone Number` columns + all hashing (`hashEmail`/`hashPhone`/`normalizePhoneE164`) from `google-conversions.ts`, and dropped the `customer_email`/`customer_phone` (orders) and `email`/`phone` (leads) selects from the endpoint and `export.ts`. Also better data-minimization (no unused hashed PII leaves for the EU cohort). **Consent columns kept** (they ARE mapped/used). 55/55 tests, tsc clean, build OK.
- **Net effect:** next upload should report **0 errors** — only matchable click-id rows are sent. Genuinely-direct orders (no Google click) are correctly excluded.
- **If cross-device recovery is ever wanted:** it needs a *separate* Enhanced Conversions for Leads action (different setup, awkward for purchases, marginal at ~43 orders/wk). Part 2.5 below is moot for the current click-based action.

#### (historical) C6 as originally built —
- **Why:** gclid is per-click/per-device. A customer who clicks the ad on their phone but buys on a laptop has no click id on the purchasing session, so a click-id-only upload misses that order. Hashed email/phone let Google match those via its identity graph — closes the cross-device gap. (Cookiebot shows ~28% opt-out and ~43 orders/week, so at this scale Consent Mode *modeling* likely does little; the cross-device gap is the more real loss, hence this layer.)
- **Built:** `buildGoogleConversionsCsv` now appends two columns — `Email`, `Phone Number` — SHA-256 hex hashed (`hashEmail`, `hashPhone`/`normalizePhoneE164` in `google-conversions.ts`). Email = trim+lowercase; phone = E.164 (`+420…`). Both the scheduled endpoint and the manual `export.ts` actions now select + pass `customer_email`/`customer_phone` (orders) and `email`/`phone` (leads).
- **Inclusion logic widened:** a row is emitted if it has **a click id OR a hashed email/phone**. Rows with none are still skipped. The consent filter is unchanged and absolute — **denied sessions emit nothing, including no PII**.
- **Google-side requirement (Part 2.5):** rows that have *only* hashed data and no click id are matched **only if** "Enhanced conversions for leads" is enabled on the conversion action; otherwise Google ignores the user-data columns and rejects those click-id-less rows (harmless — skipped, never double-counted).
- Tests: +11 (hashing/normalization, enhanced columns, cross-device email-only row, denied-still-blocks-PII). 62/62 green.

### C7. Per-row consent columns (DONE 2026-06-14)
- **Why:** sending hashed PII for EEA users means Google expects a consent signal (DMA / Consent Mode v2). Per-row is more accurate than a blanket account-level default — it won't over-claim consent for the `unknown` cohort.
- **Built:** two columns appended — `Ad User Data Consent`, `Ad Personalization Consent`. Mapping from HaloTrack `consent_status`: `granted` → `GRANTED`; `unknown` (or absent) → `UNSPECIFIED`; `denied` → row excluded entirely (unchanged). Both columns carry the same value (one consent_status → both Google signals). The endpoint now fetches `session_id → consent_status` for all rows (was: denied-only set) and stamps `r.consent`.
- **Assumption to confirm:** this treats `consent_status = granted` as covering *both* ad-measurement and ad-personalization consent. Correct if HaloTrack's gate reflects marketing consent; if it only reflects analytics consent, personalization should be downgraded.
- Tests: +4 (granted→GRANTED, unknown→UNSPECIFIED, absent→UNSPECIFIED, per-record denied→skip). **66/66 green**, tsc clean, build OK.

### C5 (optional, later) — push instead of pull
- If you ever want HaloTrack to push via the **Google Ads API** on a Vercel cron instead of Google Ads pulling: add `/api/cron/google-ads-upload` + a daily entry in `vercel.json`, using `uploadClickConversions`. Needs a Google Ads **developer token** + OAuth refresh token + customer ID + conversion action ID per client (store in `clients.settings.google_ads`). More power (richer Enhanced Conversions) but much more setup — **skip unless the pull model proves insufficient.**

---

## PART 2 — Google Ads setup (manual, in the account)

1. **Confirm auto-tagging is ON** (Admin → Account settings → Auto-tagging). This is what puts gclid/gbraid on your URLs — it already is, but verify.
2. **Create the Import conversion action:** Goals → Conversions → New → **Import → Other data sources or CRMs → Track conversions from clicks**. Name it **exactly** what C2 sends (e.g. `HaloTrack Purchase`).
   - Category: Purchase. Value: **Use the value from the upload**. Count: **Every**. Attribution: your standard (data-driven).
3. **Schedule the daily pull:** source **HTTPS**, then fill the "Link to your data source" form:
   - **URL:** `https://cdn.nejbalonky.cz/api/export/google-conversions.csv` (must end in `.csv`)
   - **Username:** anything (e.g. `google`) — ignored by the endpoint
   - **Password:** the `GOOGLE_EXPORT_KEY` value
   - Frequency **Daily**. Save.
   - Browser pre-test (works after redeploy): `…/api/export/google-conversions.csv?key=<KEY>` should download a CSV.
4. **Switch primaries** once the first upload lands and looks right:
   - `HaloTrack Purchase` (offline) → **Primary**.
   - `GA4 (web) purchase` → **Secondary** (keep as cross-check; Secondary is excluded from bidding/Conversions column, so no double-count).

   > ⚠️ **ANTI-INFLATION RULE — read before flipping anything.** Google does **NOT** de-duplicate across two different conversion actions. If you leave *both* the offline action and the GA4 import as **Primary**, every order counts twice and your ROAS inflates again — the exact problem from June 2026. The only thing that prevents double-counting is: **exactly ONE Primary purchase action** (the offline one). Everything else purchase-related = Secondary. Auto-dedup only happens *within* one action (the rolling re-sends, by gclid+name+time) and *inside GA4* (browser+server by transaction_id) — never between two separate actions. Whenever you add any new purchase conversion later, re-check that only one is Primary.
5. **Enhanced Conversions (the gclid-less / cross-device tail) — code DONE, just enable it here.** The CSV already carries hashed `Email` + `Phone Number` columns (C6). To make Google actually use them for click-id-less rows:
   - On the `HaloTrack Purchase` Import action → **Enhanced conversions** → turn **ON**, choose **"Manage settings via Google Ads API / uploads"** (not the Google tag), and accept the customer-data terms.
   - No CSV change needed — the columns are already there; without this toggle Google just ignores them.
   - PII note: this sends hashed (not raw) customer email/phone to Google for `consent_status != 'denied'` users only. Make sure your privacy policy mentions Google Ads conversion matching (see Part 6).

---

## PART 3 — Google Analytics (GA4) — what to change

- **Nothing structural.** Keep the single `purchase` key event. GA4 stays your analytics source of truth and feeds the **Secondary** GA4 import.
- Do **not** delete the GA4 import in Google Ads — demote it to Secondary so you always have an independent cross-check against the offline numbers.
- Optional later: mark `add_to_cart` as a key event (the "add to cart not set up" nudge) to give PMax a mid-funnel signal — separate from this task.

---

## PART 4 — From your current setup, change exactly this

- [x] **Code (C1–C4 + C6 Enhanced Conversions) — DONE 2026-06-13, uncommitted.** Next: commit → redeploy nejbalonky's HaloTrack project → set `GOOGLE_EXPORT_KEY` env var (`openssl rand -hex 32`).
- [ ] **Google Ads:** create `HaloTrack Purchase` Import action (Part 2.2).
- [ ] **Google Ads:** enable **Enhanced conversions for leads** (via API/uploads) on that action (Part 2.5).
- [ ] **Google Ads:** schedule daily HTTPS pull from the endpoint (Part 2.3).
- [ ] **Google Ads:** after first successful upload, set `HaloTrack Purchase` Primary, `GA4 (web) purchase` Secondary (Part 2.4).
- [ ] **Leave GA4 alone** (Part 3).
- [ ] Also fix the **Merchant Center item-ID mismatch** separately (variation IDs) — unrelated to this pipe but still open from earlier.

---

## PART 5 — Verification

1. Hit the endpoint manually with the key → confirm CSV downloads, columns correct, only consent-OK rows, gclid **and** gbraid rows present, values/currency right.
2. In Google Ads after the first scheduled run: Uploads history shows success + row count; the conversion action leaves "Pending/Needs attention" and records conversions.
3. **3+ days later** (settling window): compare `HaloTrack Purchase` value over 7 days vs actual WooCommerce revenue — should track closely, and closer than the GA4 import did.
4. No double-count: confirm GA4 import is Secondary, so the Conversions column reflects only the offline action.

---

## PART 6 — Compliance (do not skip)

Only upload click IDs for orders whose session **allowed ad/marketing storage** (Consent Mode v2 / GDPR). The C2 consent filter enforces this. Without it you'd be sending identifiers for users who declined — a real compliance problem, and Czech/EU traffic has meaningful decline rates.

**Decision (2026-06-13): include `granted` + `unknown` → filter `consent_status != 'denied'`.** The grey-area approach, chosen for coverage; consistent with how `t.js` already creates sessions for `unknown`. Declined users stay fully excluded.

**Enhanced Conversions PII (2026-06-13):** the export now also carries **hashed** (SHA-256) email + phone (C6) for the same `!= 'denied'` cohort — denied users emit nothing, including no PII. Hashed email/phone is Google's standard lower-risk format, but it is still customer data leaving HaloTrack for Google. Confirm the privacy policy mentions Google Ads conversion matching / sharing hashed identifiers with Google before the first upload runs. We rejected the idea of dropping the consent filter and uploading everything: gclid/gbraid are themselves personal data under GDPR, uploading them for denied users breaches Google's EU User Consent Policy, and HaloTrack's own DB would hold `consent_status: denied` next to the uploaded id — i.e. self-documenting evidence of a violation.

**Reminder on dedup (so the bidding signal stays clean):** Google does NOT dedup across separate conversion actions. The offline action (`HaloTrack Purchase`) and the GA4 import (`GA4 (web) purchase`) only avoid double-counting because one is **Primary** and the other **Secondary** — not because Google merges them. Auto-dedup only happens *within* one action (rolling re-sends, by gclid+name+time) and *within* GA4 (browser+server by transaction_id).

---

## PART 7 — Disable the server-side GA4 purchase send (nejbalonky)

**Sequencing changed 2026-06-14: do this in the FIRST deploy, alongside Phase 1 — NOT after the offline upload is verified.** It's the actual fix for the broken Ads numbers, run as a reversible test (see "Rollout strategy" at the top). The offline upload ships in the same deploy but only as a **Secondary** observation action; GA4 import stays Primary.

**Why:** for nejbalonky, `purchase` reaches GA4 from *two* sources — the browser (GTM4WP, real-time) and HaloTrack's server-side Measurement Protocol send (`sendToGoogle`). Pre-Tier-2 the server send used a bogus GA4 client id, so GA4 ignored it (Unassigned) and your numbers were effectively browser-driven and accurate. The June `ga_session_id` stitching woke up the second feed, and it's the leading suspect for purchases leaking to **Unassigned** in GA4 — which never reach Google Ads (Ads only imports google/cpc). Turning the server send off should let those purchases settle back to Paid Search and flow to Ads again.

**Effect of turning it off:** GA4 goes back to clean, browser-sourced analytics (as it behaved "before"). Trade-off: GA4's own reports lose the ~8–14% server-side recovery — but that's how GA4 effectively behaved when you were happy (the server send was inert pre-June), and the offline pipe covers ad-blocker resilience for the part that matters (Ads conversions). Meta CAPI, the offline upload, and the browser GA4 purchase are all **unaffected** — only the server→GA4 send stops.

**How — BUILT 2026-06-14 as a Vercel env-var kill-switch (no SQL/DB edit; creds & code kept for reuse):**
- Set **`SKIP_SERVER_GA4_PURCHASE=true`** on nejbalonky's HaloTrack deployment. Checked before `sendToGoogle` in **both** the order webhook ([webhook/order/route.ts](../../src/app/api/webhook/order/route.ts)) and lead webhook, **and** in the retry queue ([cron/retry-queue/route.ts](../../src/app/api/cron/retry-queue/route.ts)) so stale queued GA4 sends don't fire after the flip.
- Per-deployment = per-client (each client is its own deployment with its own `CLIENT_ID`), so this affects **only nejbalonky**. The `measurement_id`/`api_secret` stay in the `clients` row untouched — re-enable later by deleting the env var (or setting it `false`) and redeploying.
- Reversal cost: a redeploy (a few minutes), not instant — acceptable for a 5-day test.

**Rollback trigger:** if GA4 hasn't recovered (Unassigned shrinks, google/cpc rises, Ads daily conversions look sane) within ~5 days, set `SKIP_SERVER_GA4_PURCHASE=false` (or remove it) and redeploy — the server feed wasn't the cause, and we move to the row-level check (which specific 12-Jun orders GA4 put in Unassigned; how many HaloTrack orders carry a gclid).

- [ ] Set `SKIP_SERVER_GA4_PURCHASE=true` on nejbalonky's deployment in the same deploy as Phase 1
- [ ] Confirm `sendToGoogle` is skipped for nejbalonky (no server→GA4 purchase hits)
- [ ] Within ~5 days: GA4 Unassigned purchases shrink + google/cpc rises + Ads daily conversions normalize
- [ ] If not recovered in ~5 days → set the env var `false` + redeploy, run row-level check

---

## Manual vs code summary

| Step | Who | Where |
|---|---|---|
| Capture gbraid/wbraid; CSV builder; secured endpoint; tests + Enhanced Conv (C1–C6) | Me (code) | HaloTrack repo (✅ built) |
| `skip_server_purchase` flag (Part 7) | Me (code) | HaloTrack repo |
| One deploy: ship code + flag + set `GOOGLE_EXPORT_KEY` | You | Vercel |
| Create Import action + enable Enhanced Conversions | You | Google Ads |
| Schedule daily HTTPS pull, set action **Secondary** | You | Google Ads |
| Keep GA4 import **Primary** (for now) | You | Google Ads |
| Flip offline→Primary, GA4→Secondary — **only if the 2-week comparison says so** | You (later) | Google Ads |
| Keep one GA4 purchase key event | — | GA4 (no change) |

## Rollout order (observe-first — see "Rollout strategy" up top)
1. **One deploy:** ship Phase 1 (C1–C6, built) **+ the `skip_server_purchase` flag** + set `GOOGLE_EXPORT_KEY`.
2. Google Ads: create the Import action, enable Enhanced Conversions, schedule the daily pull, set it **Secondary**. Confirm GA4 stays the only **Primary**.
3. **Days 3–5:** verify GA4 recovered (Unassigned shrinks, google/cpc rises, Ads conversions normalize). Rollback trigger if not.
4. **~2 weeks:** compare offline vs GA4 over rolling 7-day windows.
5. **Only if offline proves more complete + stable:** flip offline → Primary, GA4 → Secondary.
6. (Optional later) Enhanced Conversions PII tail tuning, or C5 API-push.
```
