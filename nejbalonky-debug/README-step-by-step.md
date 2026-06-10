# Nej Balonky — Thank-You Page Debug Deployment

You'll deploy three pieces today. Total time: ~20 minutes.

1. **Band-aid redirect** (`.htaccess`) — stops customers landing on the Hostinger temp domain starting now.
2. **Server-side debug logger** (WordPress MU-plugin) — records every suspicious request with full server-side context.
3. **Client-side debug beacon** (GTM tag) — records the browser's view of the same requests.

The Supabase side (table + API endpoint) is already live — you don't need to touch it.

---

## What's already deployed for you on Supabase

| Piece | Location / Name |
|---|---|
| Table | `public.debug_events` in your Supabase project |
| API endpoint | `https://aiwzeqqzpvzycddfpxvt.supabase.co/functions/v1/debug-log` |
| Auth | Shared beacon token: `nbk_debug_beacon_2026_a8f3k29x` (embedded in both PHP + JS) |

You can open the Supabase dashboard anytime and query `debug_events` directly to see data flowing in.

---

## Step 1 — Deploy the `.htaccess` redirect (band-aid)

This is the fastest and highest-impact step. Do it first.

1. Open **Hostinger hPanel → Files → File Manager**.
2. Navigate to your WordPress root — usually `public_html/`.
3. Find `.htaccess`. (If you don't see it, enable "Show hidden files" in the File Manager settings.)
4. **Right-click → Download** a copy to your computer first, as a safety backup.
5. Right-click → **Edit**.
6. Scroll to the **absolute top of the file**. Paste the contents of `01-htaccess-snippet.txt` **above every `# BEGIN ...` block** — whichever one comes first. On a Hostinger + LiteSpeed setup the top will usually be `# BEGIN LiteSpeed`, followed later by `# BEGIN WordPress`. Your snippet goes **above both**.
7. Save.

### Verify

- Open an incognito window.
- Visit `https://peru-mole-473733.hostingersite.com/`
- You should instantly bounce to `https://nejbalonky.cz/`.
- Also visit `https://nejbalonky.cz/` directly — should work normally, no redirect loop.

If something breaks: restore the backup `.htaccess` and let me know what you saw.

---

## Step 2 — Deploy the MU-plugin (server-side debug)

MU-plugins ("must-use") load automatically from a special folder — you don't install or activate them in WP Admin. They can't be turned off except by deleting the file.

1. In **File Manager**, go to `public_html/wp-content/`.
2. If there's no folder called `mu-plugins`, create it (right-click → New Folder → `mu-plugins`).
3. Upload `02-nejbalonky-debug-logger.php` into that `mu-plugins/` folder.
4. That's it. WordPress will start loading it on the very next request.

### Verify

1. Open your site's thank-you page manually — e.g. `https://nejbalonky.cz/objednavka-prijata/` (it'll probably redirect or 404 without a real order, that's fine; the logger still fires).
2. Open the Supabase dashboard → **Table Editor** → `debug_events`.
3. You should see a new row with `source = 'php'`, `event_type = 'thankyou_hit'`, populated `http_host`, `wp_home_url`, etc.

### If you need to turn it off

Just delete the file from `mu-plugins/`. No uninstall needed.

### If your thank-you URL slug is different

My PHP file assumes the slug is one of: `objednavka-prijata`, `order-received`, `dekujeme`, `thank-you`. Check the URL you see after a real order completes — if it's different (e.g. `/objednavka-dokoncena/`), edit the file and add it to the `NBK_THANKYOU_SLUGS` define near the top.

---

## Step 3 — Deploy the GTM custom HTML tag (client-side debug)

1. Open [Google Tag Manager](https://tagmanager.google.com/) and pick the workspace for nejbalonky.cz.
2. **Tags → New**.
3. **Tag Configuration** → pick **Custom HTML**.
4. Paste the entire contents of `03-gtm-custom-html-tag.html` into the HTML field (including the `<script>...</script>` wrapper).
5. **Triggering** → pick **All Pages**.
6. Name the tag: `NBK — Debug Beacon (thank-you / wrong host)`.
7. **Save** → **Submit** → **Publish**.

### Verify

1. Still in GTM, click **Preview** to open Tag Assistant.
2. In Tag Assistant, enter `https://nejbalonky.cz/objednavka-prijata/` (or any thank-you URL you have).
3. The tag should fire. You can also check the Network tab of your browser's DevTools — you'll see a POST to `https://aiwzeqqzpvzycddfpxvt.supabase.co/functions/v1/debug-log`.
4. Refresh the Supabase `debug_events` table — a new row with `source = 'js'` should appear.

### Important: check the session cookie name

Near the top of the JS tag, there's this line:

```js
var sessionCookieRe = /(^|; )(_nejb_session|ft_session|session_id|nejb_sid|ft_sid)=/;
```

These are guesses at what your tracker names its session cookie. Open `nejbalonky.cz` in your browser, open DevTools → Application → Cookies, and find the cookie your tracker sets. If its name isn't in the regex, edit the GTM tag and add it. Republish.

---

## What to look at once data starts flowing

Wait ~24 hours (or until the issue recurs). Then in Supabase SQL Editor, run something like this:

```sql
-- Every debug event from the last 24h
SELECT
  created_at,
  source,
  event_type,
  http_host,
  request_uri,
  wp_home_url,
  wp_option_home,
  page_hostname,
  session_cookie_present,
  order_id
FROM debug_events
WHERE client_id = 'client_nejbalonky'
  AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC;
```

### What each pattern tells us

| Pattern in debug_events | Root cause |
|---|---|
| `http_host` = hostingersite.com on PHP rows arriving from real referers | Customers are being routed to the temp domain by something upstream (DNS, CDN, proxy, an ad link). Fix: find and correct the source URL. |
| `wp_option_home` or `wp_option_siteurl` = hostingersite.com | Your WordPress DB has the wrong canonical URL baked in. Fix: update `wp_options` table or WP Admin → Settings → General. |
| `http_host` = nejbalonky.cz BUT `page_hostname` = hostingersite.com | WordPress is doing an internal redirect to the temp domain (very likely WooCommerce building the thank-you URL from `siteurl`). Same fix as above. |
| `is_cached` set, or `http_host` = nejbalonky.cz while `wc_checkout_url` / `page_hostname` = hostingersite.com | LiteSpeed Cache is serving a page that was rendered (and cached) under the wrong host — the form actions and checkout URLs inside the HTML point at the temp domain. Fix: (a) WP Admin → LiteSpeed Cache → Toolbox → Purge → Purge All; (b) set the canonical domain correctly under LiteSpeed Cache → General → General Settings; (c) exclude `/objednavka-prijata/`, `/checkout/`, `/cart/` from caching under LiteSpeed Cache → Cache → Excludes. |
| `x_forwarded_host` = hostingersite.com while `http_host` = nejbalonky.cz | A proxy/CDN layer is mangling headers. Rare but possible on Hostinger Boost. |

Once we see which pattern dominates, the fix is 10 minutes.

---

## Turning it off

When you're done diagnosing:

- Delete `wp-content/mu-plugins/02-nejbalonky-debug-logger.php`
- In GTM, pause or delete the "NBK — Debug Beacon" tag
- Leave the `.htaccess` redirect in place — it's harmless and keeps attribution intact even if the underlying bug comes back

You can optionally drop the `debug_events` table when you're done. Tell me and I'll do it.

---

## If you get stuck

Common issues and fixes:

- **".htaccess edits broke my site"** → restore the backup you saved, or just remove the block you added.
- **"No rows showing up in debug_events"** → check Supabase → Edge Functions → `debug-log` → Logs. If you see 401s, the beacon token in the PHP/JS doesn't match the function. If no requests at all, the code isn't loading (PHP in wrong folder, GTM not published).
- **"I see rows from JS but not PHP"** → MU-plugin isn't loading. Double-check the path is exactly `public_html/wp-content/mu-plugins/02-nejbalonky-debug-logger.php` and that file permissions are 644.
