# HaloTrack

**First-party, GDPR-compliant attribution tracking system for marketing agencies.**

HaloTrack tracks visitors, attributes orders to marketing sources, and forwards conversion data to ad platforms (Facebook CAPI, Google Enhanced Conversions) with full server-side tracking and consent management.

---

## Key Features

- ✅ **True first-party cookies** (on your domain, not ours)
- ✅ **Server-side tracking** (Next.js middleware, not client-side JS)
- ✅ **GDPR compliant** (two-mode: full tracking with consent, anonymous without)
- ✅ **Multi-tenant** (shared database with client_id separation)
- ✅ **First-touch & Last-touch attribution**
- ✅ **Cross-device attribution** (email/phone matching)
- ✅ **Facebook Conversions API** integration
- ✅ **Google Enhanced Conversions** integration
- ✅ **Multi-platform support** (WooCommerce, Shopify, custom)

---

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** Supabase (PostgreSQL)
- **Authentication:** Supabase Auth
- **Hosting:** Vercel
- **Styling:** Tailwind CSS 4
- **Charts:** Recharts
- **UI Components:** Shadcn/ui

---

## Getting Started

### Prerequisites

- Node.js 20+
- Supabase account
- Vercel account (for deployment)

### 1. Clone and Install

```bash
git clone <repository-url>
cd tracking
npm install
```

### 2. Database Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Run the SQL schema:
   - Go to Supabase SQL Editor
   - Copy contents of `schema.sql`
   - Execute the script

This creates:
- `clients` - Multi-tenant client registry
- `sessions` - Full tracking data with consent
- `anon_events` - Anonymous events (no consent)
- `events` - Custom event tracking
- `orders` - Order attribution data

### 3. Environment Variables

Configure these in Vercel (or `.env.local` for local development):

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...  # Service role key (keep secret!)

# Client Configuration
CLIENT_ID=client-slug  # Unique identifier for this client
SITE_DOMAIN=client-domain.com  # Client's domain

# Optional: Admin settings
ADMIN_EMAIL=admin@youragency.com
```

**Important:** Never commit `.env.local` to git. Use Vercel environment variables for production.

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) - you'll be redirected to `/login`.

### 5. Create First User

In Supabase:
1. Go to Authentication → Users
2. Add a new user with email/password
3. Copy the user's UUID
4. In SQL Editor, create a client record:

```sql
INSERT INTO clients (client_id, name, domain, user_id, active)
VALUES ('test-client', 'Test Client', 'example.com', 'user-uuid-here', true);
```

Now you can log in to the dashboard!

---

## How It Works

### Server-Side Tracking (Middleware)

Every page request runs through Next.js middleware (`src/middleware.ts`) which:

1. **Checks for consent** (CookieYes, Cookiebot, etc.)
2. **Parses UTM parameters** and ad platform click IDs (gclid, fbclid, etc.)
3. **Creates or updates session** in database
4. **Sets first-party cookies** (`_halo`, `_fbc`, `_fbp`)
5. **Tracks first-touch & last-touch** attribution

**No client-side JavaScript required** for basic tracking!

### Order Attribution

When an order is placed:

1. Webhook received at `/api/webhook/order`
2. Normalizes order from platform (WooCommerce/Shopify/Custom)
3. Matches to session using:
   - Session ID (best) → Email → Phone → Customer ID
4. Builds attribution data (first-touch, last-touch, days to convert)
5. Forwards to Facebook CAPI & Google Enhanced Conversions
6. Saves to database

### GDPR Compliance

**With Consent (granted/unknown):**
- Full tracking with PII
- Device fingerprinting
- Cross-device attribution

**Without Consent (denied):**
- Only anonymous aggregate data
- No cookies set
- No PII collected

Users can request deletion via `/api/delete-user?email=user@example.com`

---

## Integration Guide

### For Client Websites

#### Option 1: Middleware Tracking (Same Domain)

Deploy HaloTrack on client's domain (e.g., `track.client.com`). Middleware automatically tracks all pages.

#### Option 2: JavaScript Loader (External Domain)

Add this to client's website:

```html
<script src="https://your-halotrack.vercel.app/t.js" async></script>
```

**Optional: Link user identity (after form submission):**

```javascript
window.addEventListener('halotrack:ready', () => {
  // After user submits form
  window.HaloTrack.identify({
    email: 'user@example.com',
    phone: '+420123456789',
    customer_id: 'wc_customer_123'
  })
})
```

### Webhook Setup

#### WooCommerce

1. Install **WooCommerce Webhooks** plugin
2. Add webhook:
   - **URL:** `https://your-halotrack.vercel.app/api/webhook/order`
   - **Topic:** Order Created
   - **Secret:** (optional, for signature verification)
3. Add session ID to order meta:

```php
// functions.php
add_action('woocommerce_checkout_update_order_meta', function($order_id) {
    if (isset($_COOKIE['_halo'])) {
        update_post_meta($order_id, '_halo_session', $_COOKIE['_halo']);
    }
});
```

#### Shopify

1. Settings → Notifications → Webhooks
2. Create webhook:
   - **Event:** Order creation
   - **URL:** `https://your-halotrack.vercel.app/api/webhook/order`
   - **Format:** JSON
3. Add session ID via theme:

```liquid
{% if request.cookies._halo %}
<script>
fetch('/cart/update.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    attributes: { halo_session_id: '{{ request.cookies._halo }}' }
  })
})
</script>
{% endif %}
```

---

## Dashboard Features

Access at `/dashboard` after login:

- **Stats Cards:** Revenue, orders, attribution rate, avg days to convert
- **Date Range Picker:** Filter by custom date ranges (7/30/90 days)
- **Revenue by Source:** First-touch and last-touch attribution tables
- **Revenue Chart:** Daily revenue timeline (Recharts)
- **Recent Orders:** Last 5 orders with attribution details

---

## API Reference

### POST `/api/webhook/order`

Receive order webhooks from e-commerce platforms.

**Body (auto-normalized from WooCommerce/Shopify/Custom):**
```json
{
  "order_id": "123",
  "total": 1500.50,
  "currency": "CZK",
  "email": "customer@example.com",
  "phone": "+420123456789",
  "session_id": "optional-halo-session-id",
  "items": [...]
}
```

**Response:**
```json
{
  "success": true,
  "attributed": true,
  "match_type": "session",
  "forwarded": {
    "facebook": true,
    "google": true
  }
}
```

### POST `/api/identify`

Link email/phone to existing session (for cross-device).

**Body:**
```json
{
  "email": "user@example.com",
  "phone": "+420123456789",
  "customer_id": "wc_123"
}
```

### DELETE `/api/delete-user?email=user@example.com`

GDPR deletion - removes PII, anonymizes orders.

### POST `/api/event`

Track custom events.

**Body:**
```json
{
  "event_name": "add_to_cart",
  "properties": {
    "product_id": "123",
    "value": 99.50
  }
}
```

---

## Development Commands

```bash
# Development
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Build for production
npm run start        # Run production build locally
npm run lint         # Run ESLint

# Type checking
npx tsc --noEmit     # Check TypeScript types
```

---

## Deployment Checklist

### First Deployment (Agency/Developer)

1. ✅ Create Supabase project
2. ✅ Run `schema.sql` in Supabase SQL Editor
3. ✅ Deploy to Vercel (connect repo)
4. ✅ Add environment variables in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
5. ✅ Wait for deployment

### Per-Client Setup

1. ✅ Add client's domain in Vercel project settings
2. ✅ Client adds CNAME: `track.client.com` → `cname.vercel-dns.com`
3. ✅ Create client record in Supabase:
   ```sql
   INSERT INTO clients (client_id, name, domain, user_id)
   VALUES ('client-slug', 'Client Name', 'client.com', null);
   ```
4. ✅ Create Supabase Auth user for client access
5. ✅ Link user to client:
   ```sql
   UPDATE clients SET user_id = 'user-uuid' WHERE client_id = 'client-slug';
   ```
6. ✅ Configure ad platform credentials in client settings JSONB
7. ✅ Test tracking: Visit site with `?utm_source=test`
8. ✅ Verify session created in Supabase
9. ✅ Send test order webhook
10. ✅ Verify attribution in dashboard

---

## Project Structure

```
tracking/
├── src/
│   ├── app/
│   │   ├── dashboard/          # Protected dashboard
│   │   │   ├── components/     # Dashboard UI components
│   │   │   ├── layout.tsx      # Auth wrapper
│   │   │   └── page.tsx        # Main dashboard page
│   │   ├── login/              # Login page
│   │   ├── api/
│   │   │   ├── webhook/order/  # Order attribution endpoint
│   │   │   ├── identify/       # Cross-device linking
│   │   │   ├── event/          # Custom events
│   │   │   ├── touch/          # External JS loader endpoint
│   │   │   └── delete-user/    # GDPR deletion
│   │   ├── actions/            # Server actions
│   │   └── layout.tsx          # Root layout
│   ├── lib/
│   │   ├── supabase/           # Supabase clients
│   │   ├── forwarding/         # Ad platform integrations
│   │   │   ├── facebook.ts     # Facebook CAPI
│   │   │   └── google.ts       # Google Enhanced Conversions
│   │   └── utils.ts            # Utilities
│   ├── components/ui/          # Shadcn components
│   ├── types/                  # TypeScript definitions
│   └── middleware.ts           # Server-side tracking
├── public/
│   └── t.js                    # Lightweight JS loader
├── schema.sql                  # Database schema
└── CLAUDE_TRACK.md             # Full specification
```

---

## Ad Platform Configuration

### Facebook Conversions API

1. Get Pixel ID from Facebook Events Manager
2. Generate access token:
   - Events Manager → Settings → Conversions API → Generate Access Token
3. Add to client settings in Supabase:
   ```sql
   UPDATE clients
   SET settings = jsonb_set(settings, '{facebook}',
     '{"pixel_id": "123456789", "access_token": "EAAx...", "test_event_code": "TEST123"}'::jsonb
   )
   WHERE client_id = 'client-slug';
   ```

**Test:** Send test order, check Events Manager → Test Events

### Google Enhanced Conversions

1. Get Measurement ID from Google Analytics 4
2. Generate API Secret:
   - GA4 → Admin → Data Streams → Select stream → Measurement Protocol API secrets
3. Add to client settings:
   ```sql
   UPDATE clients
   SET settings = jsonb_set(settings, '{google}',
     '{"measurement_id": "G-XXXXXXXXX", "api_secret": "abc123..."}'::jsonb
   )
   WHERE client_id = 'client-slug';
   ```

**Test:** Check GA4 Realtime reports after test purchase

---

## Troubleshooting

### Sessions not being created

- Check middleware is running (add console.log)
- Verify `CLIENT_ID` env variable is set
- Check Supabase service key has correct permissions
- Ensure middleware matcher excludes static files

### Orders not attributed

- Verify session cookie (`_halo`) is present in order webhook
- Check session_id is passed in order meta/attributes
- Test email/phone matching if session_id missing
- Review attribution waterfall in code comments

### Facebook CAPI errors

- Validate pixel_id and access_token in settings
- Check hashed email/phone format (lowercase, trimmed)
- Use test_event_code to debug in Events Manager
- Verify event_id for deduplication

### Google EC not showing

- GA4 has 24-48h delay for reports
- Check Realtime view for immediate feedback
- Verify measurement_id and api_secret are correct
- Ensure user_data is properly hashed

---

## Security Notes

- Service role key (`SUPABASE_SERVICE_KEY`) must be kept secret
- Never expose service key in client-side code
- Row Level Security (RLS) enabled on all tables
- IP addresses are hashed (SHA-256) before storage
- PII is hashed before sending to ad platforms
- Webhook signature verification recommended for production

---

## License

Proprietary - Internal use for HaloAgency clients only.

---

## Support

For issues or questions:
- Check `CLAUDE_TRACK.md` for full specification
- Review code comments in implementation files
- Contact development team

---

Built with ❤️ by HaloAgency
