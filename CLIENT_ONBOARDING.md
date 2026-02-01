# HaloTrack Client Onboarding Guide

Complete step-by-step guide for onboarding new clients to the HaloTrack lead tracking system.

---

## Prerequisites

- HaloTrack deployed on Vercel
- Supabase project with all tables created
- Client's website with forms (landing page)

---

## Part 1: Database Setup (5 minutes)

### Step 1: Create Client Record

Go to **Supabase Dashboard** → **SQL Editor** and run:

```sql
INSERT INTO clients (client_id, name, domain, user_id)
VALUES (
  'client_acme',                    -- Unique ID (use company name)
  'Acme Corporation',               -- Display name
  'acme.com',                       -- Client's domain
  NULL                              -- Will link user later
);
```

**Important:** Save the `client_id` (e.g., `client_acme`) - you'll need it for environment variables.

### Step 2: Create Dashboard Login

1. Go to **Supabase Dashboard** → **Authentication** → **Users**
2. Click **Add User**
3. Enter client's email and password (e.g., `admin@acme.com` / `SecurePass123`)
4. **Copy the User UID** from the user list

### Step 3: Link User to Client

Run this SQL (replace `USER_UID_HERE` with the copied UID):

```sql
UPDATE clients 
SET user_id = 'USER_UID_HERE' 
WHERE client_id = 'client_acme';
```

---

## Part 2: Deploy Client Instance (10 minutes)

### Option A: New Vercel Project (Recommended for Multiple Clients)

1. **Fork/Clone** the HaloTrack repository
2. **Deploy to Vercel** from the new repo
3. **Set Environment Variables** in Vercel:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_KEY=your-service-key
   CLIENT_ID=client_acme
   ```
4. **Add Custom Domain** (optional): `tracking.acme.com`

### Option B: Same Deployment (Single Client)

Just update the `CLIENT_ID` environment variable in Vercel to `client_acme` and redeploy.

---

## Part 3: Install Measurement Scripts (5 minutes)

Add **BOTH** of these scripts to the `<head>` section of **every page** on the client's website.

### 1. Meta Pixel (Client-Side Tracking)
This tracks standard page views directly in the browser.

```html
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '2213571369171089'); // Data Dataset ID
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=2213571369171089&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->
```

### 2. HaloTrack (Server-Side Attribution)
This tracks sessions and enables the robust Conversions API.

```html
<!-- HaloTrack Attribution Tracking -->
<script src="https://your-halotrack-domain.vercel.app/t.js" async></script>
```

**Crucial Note**: The Meta Pixel handles "lightweight" tracking, while HaloTrack handles the "heavy lifting" (server-side matching, attribution, and Conversions API). Facebook effectively combines these two signals.

### Step 2: Verify Installation

1. Open the client's website
2. Open browser DevTools → Console
3. Check for `HaloTrack` object:
   ```javascript
   console.log(window.HaloTrack)
   // Should show: { sessionId: "...", getSessionId: function, ... }
   ```
4. Check cookies → Look for `_halo` cookie

---

## Part 4: Integrate Forms (15 minutes per form)

### Example: Contact Form Integration

#### Original HTML Form:
```html
<form id="contact-form" action="/submit" method="POST">
  <input type="text" name="name" placeholder="Your Name" required>
  <input type="email" name="email" placeholder="Email" required>
  <input type="tel" name="phone" placeholder="Phone">
  <textarea name="message" placeholder="Message"></textarea>
  <button type="submit">Send</button>
</form>
```

#### Updated Form with HaloTrack:
```html
<form id="contact-form">
  <input type="text" name="name" placeholder="Your Name" required>
  <input type="email" name="email" placeholder="Email" required>
  <input type="tel" name="phone" placeholder="Phone">
  <textarea name="message" placeholder="Message"></textarea>
  
  <!-- Hidden field for session tracking -->
  <input type="hidden" name="halo_session" id="halo-session">
  
  <!-- GDPR Consent (required for EU) -->
  <label>
    <input type="checkbox" name="consent" required>
    I agree to the <a href="/privacy">Privacy Policy</a>
  </label>
  
  <button type="submit">Send</button>
</form>

<script>
// Wait for HaloTrack to load
window.addEventListener('halotrack:ready', function() {
  // Set session ID in hidden field
  document.getElementById('halo-session').value = window.HaloTrack.getSessionId()
})

// Handle form submission
document.getElementById('contact-form').addEventListener('submit', async function(e) {
  e.preventDefault()
  
  const formData = new FormData(e.target)
  
  // Send to HaloTrack
  const response = await fetch('https://your-halotrack-domain.vercel.app/api/webhook/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lead_id: 'lead_' + Date.now(),
      source: 'website_contact_form',
      form_type: 'contact',
      
      // Contact info
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      message: formData.get('message'),
      
      // Attribution
      session_id: formData.get('halo_session'),
      
      // GDPR
      consent_given: formData.get('consent') === 'on',
      
      // Optional: Lead value
      lead_value: 50,  // Assign value based on form type
      currency: 'CZK'
    })
  })
  
  const result = await response.json()
  
  if (result.success) {
    // Show success message
    alert('Thank you! We will contact you soon.')
    e.target.reset()
  } else {
    alert('Error submitting form. Please try again.')
  }
})
</script>
```

---

## Part 5: Multiple Forms Setup

For landing pages with **multiple forms** (e.g., Contact, Demo Request, Quote):

### Form 1: Contact Form
```javascript
{
  lead_id: 'lead_' + Date.now(),
  source: 'website_contact_form',
  form_type: 'contact',
  lead_value: 50,
  // ... other fields
}
```

### Form 2: Demo Request
```javascript
{
  lead_id: 'lead_' + Date.now(),
  source: 'website_demo_form',
  form_type: 'demo',
  lead_value: 200,  // Higher value for demo requests
  custom_fields: {
    company_size: formData.get('company_size'),
    industry: formData.get('industry')
  }
}
```

### Form 3: Quote Request
```javascript
{
  lead_id: 'lead_' + Date.now(),
  source: 'website_quote_form',
  form_type: 'quote',
  lead_value: 500,  // Highest value
  custom_fields: {
    budget: formData.get('budget'),
    timeline: formData.get('timeline')
  }
}
```

**Tip:** Use different `form_type` values to segment leads in reports.

---

## Part 6: Testing (5 minutes)

### Test Lead Submission

1. **Open client's website** with UTM parameters:
   ```
   https://acme.com/?utm_source=google&utm_medium=cpc&utm_campaign=test
   ```

2. **Fill out and submit a form**

3. **Check Supabase** → Table Editor → `leads`:
   - Verify lead was created
   - Check `attribution_data` → should show UTM parameters
   - Check `match_type` → should be `session`

4. **Check Dashboard**:
   - Login at `https://your-halotrack-domain.vercel.app/login`
   - Use credentials from Step 2
   - Verify lead appears in dashboard

---

## Part 7: Ad Platform Integration (Optional, 10 minutes)

### Facebook Lead Ads

1. Go to **Supabase** → SQL Editor
2. Update client settings:
```sql
UPDATE clients 
SET settings = jsonb_set(
  settings,
  '{facebook}',
  '{
    "pixel_id": "YOUR_PIXEL_ID",
    "access_token": "YOUR_ACCESS_TOKEN",
    "test_event_code": "TEST12345"
  }'::jsonb
)
WHERE client_id = 'client_acme';
```

### Google Offline Conversions

```sql
UPDATE clients 
SET settings = jsonb_set(
  settings,
  '{google}',
  '{
    "measurement_id": "G-XXXXXXXXXX",
    "api_secret": "YOUR_API_SECRET"
  }'::jsonb
)
WHERE client_id = 'client_acme';
```

---

## Part 8: GDPR Compliance Checklist

- ✅ Privacy Policy updated to mention HaloTrack
- ✅ Cookie consent banner installed (CookieYes, Cookiebot, etc.)
- ✅ Consent checkbox on all forms
- ✅ Data deletion endpoint documented: `DELETE /api/delete-user?email=user@example.com`

---

## Troubleshooting

### Lead not attributed to campaign

**Problem:** Lead shows `match_type: none`

**Solutions:**
1. Check if `_halo` cookie is set (DevTools → Application → Cookies)
2. Verify `session_id` is passed in form submission
3. Check if user visited with UTM parameters first

### Script not loading

**Problem:** `window.HaloTrack` is undefined

**Solutions:**
1. Check script URL is correct
2. Check CORS settings in Vercel
3. Verify script is in `<head>` with `async` attribute

### Leads not forwarding to Facebook/Google

**Problem:** `sent_to_facebook: false`

**Solutions:**
1. Verify API credentials in `clients.settings`
2. Check `consent_given: true` in lead data
3. Check Supabase logs for errors

---

## Quick Reference

### Important URLs
- **Dashboard**: `https://your-halotrack-domain.vercel.app/dashboard`
- **Lead Webhook**: `https://your-halotrack-domain.vercel.app/api/webhook/lead`
- **Tracking Script**: `https://your-halotrack-domain.vercel.app/t.js`

### Database Tables
- `clients` - Client accounts
- `sessions` - Visitor sessions with attribution
- `leads` - Form submissions
- `orders` - E-commerce purchases (future)

### Key Fields
- `client_id` - Unique identifier for each client
- `session_id` - Links leads to attribution data
- `form_type` - Segment leads by form
- `lead_value` - Prioritize high-value leads
- `consent_given` - GDPR compliance flag

---

## Next Steps After Onboarding

1. **Monitor Dashboard** - Check lead attribution daily
2. **Optimize Forms** - A/B test different `lead_value` assignments
3. **Review Attribution** - Identify best-performing campaigns
4. **Scale** - Add more forms or landing pages
5. **Integrate CRM** - Export leads to client's CRM system

---

## Support

For issues or questions, check:
1. Supabase logs (Database → Logs)
2. Vercel deployment logs
3. Browser console errors on client's website
