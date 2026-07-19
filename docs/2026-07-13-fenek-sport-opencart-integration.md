# Fenek Sport (OpenCart) — HaloTrack integration brief

**Status:** Not started — this doc is the handoff brief to begin implementation.
**Deal:** 7 000 Kč, no upfront payment. Client pays only if the trial implementation works well; further terms discussed after. Client already knows about the Google Ads tracking issues (discussed separately) — no need to re-explain that part to them.

---

## 1. What we're building

A server-side order-capture integration for OpenCart, following the same architecture as the existing WooCommerce plugin: HaloTrack's session/attribution tracking stays client-side (`t.js`), but **order capture happens entirely server-side**, hooked into OpenCart's own order-status-change event — independent of whether the customer's browser ever successfully renders a "thank you" page.

This is a deliberate reaction to what we found on the client's current setup (see §3): purchase tracking there is 100% dependent on the browser reaching a specific page after payment, which is fragile (mobile in-app browsers, 3D Secure bank redirects, ad blockers). We are not trying to fix that old scheme — we're bypassing it.

---

## 2. Site facts (already confirmed — don't re-derive)

- **Platform:** OpenCart **3.0.3.3**, Twig templates.
- **Theme:** `esport` (custom/purchased).
- **Checkout:** NOT native OpenCart checkout. Uses a third-party plugin, **SimpleCheckout** (by simpleopencart.com), AJAX one-page checkout. Its controller is `catalog/controller/checkout/simplecheckout.php`, JS bootstraps against `mainRoute: "checkout/simplecheckout"`.
- **Order confirmation page:** despite SimpleCheckout, order completion still redirects to the **native** OpenCart route `checkout/success` — confirmed in `simplecheckout.php`: `$redirect_url = $this->url->link('checkout/success')`, stored in a hidden field and used by SimpleCheckout's JS to navigate the browser there after order creation. This route's controller (`catalog/controller/checkout/success.php`) renders view `common/success`, template file **`catalog/view/theme/esport/template/common/success.twig`** (filed under "common" in the admin Theme Editor, NOT "checkout" — this tripped us up for an hour, don't repeat that).
- **Existing tracking code in `success.twig`** (present, syntactically intact, NOT deleted):
  - Yandex Metrika goal: `ym(88454672,'reachGoal','form_order')`
  - GTM custom event: `window.dataLayer.push({'event': 'form_order'})`
  - Native (non-GTM) Google Ads conversion: `gtag('event','conversion',{send_to:'AW-11043163035/jjT6CJXO5ogYEJuX5ZEp', value: total, currency:'CZK', transaction_id: order_id})`
  - Google Customer Reviews opt-in widget
  - Seznam retargeting conversion (`window.rc.conversionHit(...)`)
- **Known real bug (not proven to be THE root cause, but worth flagging/fixing separately):** `catalog/controller/checkout/success.php` line 89 makes a blocking `file_get_contents()` call to `heureka.cz` with no timeout and no error handling, *before* the view (and all tracking scripts) renders. Endpoint tested healthy from our side (200 OK, ~0.2s) — but this remains a fragility risk (no timeout guard) and leaks customer email into a URL. Low priority, not in scope for the 7 000 Kč trial unless client asks.
- **Root cause of the Google Ads "Misconfigured" purchase conversions (~May 7 cutoff) was NOT conclusively found** despite a deep investigation. Ruled out: deleted/missing tracking code (it's there), the Heureka call hanging (response times are fast, 0.5–1.2s across a week of access logs), and a Consent Mode default gap (GTM debug's Consent tab shows `ad_storage`/`ad_user_data`/`analytics_storage` = **Granted** by default even with no explicit `gtag('consent','default',...)` call — only `ad_personalization` is Denied via an account-level EEA setting, which doesn't block basic conversion counting). One unconfirmed lead: a single `499` (connection aborted) in access logs tied to a Facebook in-app browser returning from a GPWebPay 3D Secure redirect — suggestive of redirect-chain fragility on mobile in-app browsers, not proven systemic. **Don't re-open this investigation** unless the client gives new information (we asked him in the outreach email what changed on the site around early May — check his reply first).
- **Consent banner** (`annytab_cookie_consent.js`, in theme `template/common/annytab_cookie_consent.twig`) does **not** block any scripts — confirmed by reading its full 42-line source. It only calls `gtag('consent','update',{...granted})` on accept-click and sets a cosmetic `CookieConsent` cookie. Not a blocker for anything we're building.
- **Google Ads Data Manager** confirms: GA4 property **is** linked to this Ads account ("Google Analytics (GA4) — 1 linked"), and Google Merchant Center is linked too (though OpenCart's native "Google Shopping" advertising extension is currently **disabled** — separate finding, mention to client if relevant, not in scope).

### Local resources already on this machine

- **Full FTP dump of the OpenCart codebase:** `/Users/artemhorvatsky/fenek/` — contains `admin/`, `catalog/`, `config/`, `config.php`, `engine/`, `logs/`, `modification/` (product images and cache/session/log dirs were deliberately skipped when downloading — re-download from FTP if something's missing).
- **Hosting access/PHP logs:** `/Users/artemhorvatsky/fenek/hosting-logs/` — only ~1 week retention, doesn't reach back to the original break date.
- **Server webroot path:** `/home/html/fenek-sport.cz/public_html/www/`
- **FTP host:** `ftp.fenek-sport.cz`
- **Admin panel:** `fenek-sport.cz/admin/` (client-provided a separate admin user).

---

## 3. HaloTrack-side resources to reuse — do not rebuild these

- **Reference implementation pattern:** [`integrations/woocommerce/halotrack-woocommerce.php`](../integrations/woocommerce/halotrack-woocommerce.php) (352 lines). Port this pattern, don't start from scratch:
  - Enqueues `t.js` on every page
  - Injects/reads a session-id at checkout time
  - Saves session id onto the order at creation time (multiple fallback sources: form field → request body → `_halo` cookie)
  - Forwards the order to HaloTrack on a "payment complete"-equivalent hook, with a dedupe flag to avoid double-sending
  - Has an admin settings page for HaloTrack URL + webhook secret
- **Standard client onboarding steps:** [`NEW_CLIENT_SETUP.md`](../NEW_CLIENT_SETUP.md) and [`CLIENT_ONBOARDING.md`](../CLIENT_ONBOARDING.md) at repo root — Supabase `clients` record, `ALLOWED_ORIGINS` in `src/middleware.ts`, new Vercel deployment + env vars, GA4 `measurement_id`/`api_secret` into `clients.settings`.
- **Order/lead forwarding to Google — already built, tested, and working in production** (this is the mechanism, NOT the CSV one — see next bullet):
  - [`src/lib/forwarding/google.ts`](../src/lib/forwarding/google.ts) — `sendToGoogle()`, fires a real-time server-to-server POST to GA4 Measurement Protocol (`https://www.google-analytics.com/mp/collect`) with a `purchase` event, `gclid`, GA4 session id, and hashed email/phone for Enhanced Conversions.
  - [`src/lib/forwarding/google-lead.ts`](../src/lib/forwarding/google-lead.ts) — same, for leads (`generate_lead_v2` event).
  - This is the **same shared code every HaloTrack client uses** — nothing site-specific to write here. Just get Fenek Sport's client config wired (§4) and it flows through automatically.
- **Explicitly do NOT use:** [`src/lib/google-conversions.ts`](../src/lib/google-conversions.ts) / `/api/export/google-conversions` (the CSV-based scheduled Offline Conversion Import). Client rejected this approach. It's also currently not even live for nejbalonky (see [`docs/2026-07-03-handoff-tracking-state.md`](2026-07-03-handoff-tracking-state.md)) — unrelated to this task, don't touch it.
- **Needs verification before building:** does `/api/webhook/order` already normalize non-WooCommerce-shaped payloads, or is it hardcoded to the WooCommerce shape (`line_items`, `meta_data[]` with `_halo_session`)? If not generic, we'll need a small OpenCart-shape normalizer added there.

---

## 4. Architecture to build (new work)

### 4a. OpenCart extension (PHP)

Model directly on the WooCommerce plugin, adapted to OpenCart's Events system (Extensions → Events, available since OC 2.3+):

1. **Install:** create a new table (OpenCart has no generic order-meta store like WooCommerce does):
   ```sql
   CREATE TABLE oc_order_halotrack (
     order_id INT PRIMARY KEY,
     session_id VARCHAR(64),
     customer_ip VARCHAR(45),
     forwarded_at DATETIME NULL
   );
   ```
2. **Event hook on `addOrder/after`** (fires within the customer's own browser request — `_halo` cookie is present here):
   - Read `_halo` cookie from the request
   - Insert `order_id → session_id (+ customer IP)` into `oc_order_halotrack`
3. **Event hook on `addOrderHistory/after`** (fires on ANY status change — may come from a completely different request, e.g. a bank/PSP webhook with no cookies at all, which is exactly why step 2 persists the session id ahead of time):
   - Check if the new status is in a configurable "counts as paid" list (admin setting)
   - Look up `session_id`/`customer_ip` from `oc_order_halotrack` by `order_id`
   - Skip if `forwarded_at` already set (dedupe)
   - Build order payload (id, total, currency, line items, customer email/phone) and `POST` to `https://<halotrack-domain>/api/webhook/order` with header `x-webhook-secret`
   - On success, set `forwarded_at`
4. **Admin settings page** (mirrors the WooCommerce plugin's): HaloTrack URL, webhook secret, list of order statuses that count as "paid" (need to pull the actual status list from this store's Admin → Sales → Order Status — not yet confirmed which IDs/names to use).

> **Performance requirement — do not repeat the Heureka bug (§2):** the webhook POST in step 3 MUST use a short, explicit timeout (1-2s) and be wrapped in try/catch with a silent/logged failure — never let it block or fail the order flow. Good news found while investigating this: for card payments, `addOrderHistory` is mostly triggered from the payment gateway's own async server-to-server notification (`catalog/controller/payment/uniadapter.php` — GPWebPay and other gateways here route through `callback`/`notify`/`postback` actions, decoupled from the customer's browser, see `processReply()` around line 348-411), so in most cases the customer never waits on this request at all. Still, add the timeout/try-catch as defense-in-depth for the cases where it isn't (bank transfer, cash on delivery, or the "immediate status" branch in `processReply()`).

### 4b. Client-side

- Add `<script src="https://<halotrack-domain>/t.js" async></script>` to `catalog/view/theme/esport/template/common/header.twig`.

### 4c. HaloTrack backend

- Verify/build OpenCart payload normalization on `/api/webhook/order` (see §3, last bullet).

### 4d. Client onboarding (standard, per NEW_CLIENT_SETUP.md)

- New Supabase `clients` row (`client_fenek_sport` or similar)
- Add `fenek-sport.cz` / `www.fenek-sport.cz` to `ALLOWED_ORIGINS` in `src/middleware.ts`
- New Vercel deployment — **start on the default `*.vercel.app` domain, not a custom subdomain** (client hasn't added a CNAME yet — see caveat below)
- GA4 `measurement_id`/`api_secret` into `clients.settings.google` (GA4 property is confirmed linked to their Ads account, per §2)

> **Cookie caveat to keep in mind during the trial:** the `_halo` session cookie is set via `Set-Cookie` on `/api/touch`'s response — if HaloTrack runs on the bare `*.vercel.app` domain, this is a genuine third-party cookie (different eTLD+1 from `fenek-sport.cz`) and will be blocked/expired quickly by Safari ITP and Firefox ETP. This degrades attribution accuracy (gclid capture specifically) for a meaningful chunk of traffic during the trial — it does NOT block order capture/forwarding itself. Fix: ask the client for a single CNAME record (`track` → `cname.vercel-dns.com`) — not DNS panel access — once we're ready to move off the trial domain.

---

## 5. Test plan

One real test order, approved by the client in advance, paid by card specifically (to exercise the GPWebPay 3D Secure redirect path — the one place we saw an anomaly). With DevTools open, or just checked after the fact, verify each of these individually (not just the DB flag):

- [ ] Row appears in `order_halotrack` with a non-null `session_id`
- [ ] `forwarded_at` gets set after the status change (order actually forwarded, not just eligible)
- [ ] Order appears in the HaloTrack dashboard with attribution (source/medium/gclid if present)
- [ ] `sent_to_google = true` on the HaloTrack lead/order record
- [ ] `purchase` event visible in GA4 Realtime
- [ ] Transaction ID, amount, and currency on the GA4 event match the real order exactly
- [ ] That GA4 `purchase` gets imported into Google Ads (Goals → Conversions → Import → Google Analytics 4)
- [ ] The resulting conversion action is configured as **Primary** in Google Ads (not left as Secondary/uncategorized — see the goal-mixing issue noted in §2, don't repeat that mistake for the new action)

---

## 6. Open questions / TODO before or during build

- [ ] Check client's reply about what changed on the site around early May (asked in outreach email) — may shortcut nothing critical, but good context.
- [ ] Get the actual list of order status IDs/names from Admin → Sales → Order Status to decide what counts as "paid" for the forwarding trigger.
- [ ] Confirm `/api/webhook/order`'s payload handling (§3) before assuming it Just Works for a non-WooCommerce shape.
- [ ] Once trial is proven, revisit the CNAME/custom-subdomain step (§4d caveat).
