# Tier 1 Reliability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the three Tier 1 reliability features — retry queue for failed ad platform forwards (1.1), volume drop alerting via Telegram (1.2), and a Signal Health dashboard panel (1.3) — to stop silent data loss in HaloTrack.

**Architecture:**
- **1.1 Retry queue:** New `forwarding_queue` Supabase table + `enqueueFailedForwarding()` helper + modifications to lead/order webhooks to enqueue on failure + Vercel cron endpoint (`/api/cron/retry-queue`) that replays stored payloads with exponential backoff.
- **1.2 Volume alerting:** Vercel cron endpoint (`/api/cron/volume-alert`) compares lead counts against 7-day historical average and POSTs to n8n webhook URL for Telegram delivery. Also monitors `sent_to_facebook=false` ratio and `match_type='none'` ratio.
- **1.3 Signal health dashboard:** New server action (`getSignalHealth`) queries 9 metrics per client and a new `SignalHealth` React component displays them color-coded (green ≥90%, yellow 70–89%, red <70%), added to the bottom of the dashboard.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (PostgreSQL), Vercel Cron, n8n (Telegram), Tailwind CSS, Lucide React icons

---

## Types Cross-Check (read before executing)

Every new DB column or type introduced in this plan:

| New field / table | TypeScript interface | File |
|---|---|---|
| `forwarding_queue` table | `ForwardingQueue` | `src/types/index.ts` |
| `ForwardingResult.payload` | `ForwardingResult` (updated) | `src/types/index.ts` |
| `SignalHealthData` | `SignalHealthData` | `src/types/dashboard.ts` |
| `SignalHealthMetric` | `SignalHealthMetric` | `src/types/dashboard.ts` |

---

## Task 1: DB migration — forwarding_queue table

**Files:**
- Modify: `schema.sql` (source of truth — actual migration runs in Supabase SQL editor)

### Step 1: Add table definition to schema.sql

Add this block to `schema.sql` after the `user_dashboard_activity` table and before `-- INDEXES`:

```sql
-- FORWARDING QUEUE (retry failed ad platform calls)
CREATE TABLE forwarding_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('lead', 'order')),
  event_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'google')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
  attempts INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Add these lines to the `-- INDEXES` section:

```sql
CREATE INDEX idx_fq_pending ON forwarding_queue(status, next_retry_at) WHERE status = 'pending';
CREATE INDEX idx_fq_client ON forwarding_queue(client_id);
```

Add these lines to the `-- ROW LEVEL SECURITY` section:

```sql
ALTER TABLE forwarding_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON forwarding_queue FOR ALL USING (true);
```

### Step 2: Run migration in Supabase SQL editor

Open Supabase Dashboard → SQL Editor and run:

```sql
CREATE TABLE forwarding_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('lead', 'order')),
  event_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'google')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
  attempts INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fq_pending ON forwarding_queue(status, next_retry_at) WHERE status = 'pending';
CREATE INDEX idx_fq_client ON forwarding_queue(client_id);

ALTER TABLE forwarding_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON forwarding_queue FOR ALL USING (true);
```

### Step 3: Verify — run this SQL in Supabase SQL editor

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'forwarding_queue' 
ORDER BY ordinal_position;
```

**Expected:** 12 rows with columns: id, client_id, event_type, event_id, platform, payload, status, attempts, next_retry_at, last_error, created_at, updated_at.

### Step 4: Commit

```bash
git add schema.sql
git commit -m "feat: add forwarding_queue table for retry mechanism"
```

---

## Task 2: TypeScript types for ForwardingQueue

**Files:**
- Modify: `src/types/index.ts`

### Step 1: Update ForwardingResult to include payload

Find the existing `ForwardingResult` interface and replace it with:

```typescript
export interface ForwardingResult {
  success: boolean
  response?: any
  error?: any
  payload?: Record<string, any>  // the exact HTTP payload sent; stored in queue on failure
}
```

### Step 2: Add ForwardingQueue interface

Add after `ForwardingResult`:

```typescript
export interface ForwardingQueue {
  id: string
  client_id: string
  event_type: 'lead' | 'order'
  event_id: string
  platform: 'facebook' | 'google'
  payload: Record<string, any>
  status: 'pending' | 'sent' | 'failed' | 'dead'
  attempts: number
  next_retry_at: string
  last_error: string | null
  created_at: string
  updated_at: string
}
```

### Step 3: Verify TypeScript compiles

```bash
npx tsc --noEmit
```

**Expected:** no errors.

### Step 4: Commit

```bash
git add src/types/index.ts
git commit -m "feat: add ForwardingQueue type and payload field to ForwardingResult"
```

---

## Task 3: Return payload from all 4 forwarding functions

The retry cron replays the stored payload directly to the ad platform endpoint. This requires each forwarding function to include the payload it built in the returned result — both on success and failure.

**Files:**
- Modify: `src/lib/forwarding/facebook.ts`
- Modify: `src/lib/forwarding/facebook-lead.ts`
- Modify: `src/lib/forwarding/google.ts`
- Modify: `src/lib/forwarding/google-lead.ts`

The same 3-line pattern applies to all 4 files:
1. Declare `let payload: Record<string, any> | undefined` before the `try` block
2. Change `const payload = { ... }` inside the try to `payload = { ... }` (assignment, not declaration)
3. Add `payload` to every `return` statement

### Step 1: Modify src/lib/forwarding/facebook.ts

```typescript
export async function sendToFacebook(params: FacebookParams): Promise<ForwardingResult> {
    const { session, order, eventId, pixelId, accessToken, testEventCode } = params
    let payload: Record<string, any> | undefined  // declare outside try

    try {
        const hashedEmail = order.email ? await sha256(order.email.toLowerCase().trim()) : null
        const hashedPhone = order.phone ? await sha256(normalizePhone(order.phone)) : null
        const hashedCountry = session.country ? await sha256(session.country.toLowerCase()) : null
        const hashedCity = session.city ? await sha256(session.city.toLowerCase().replace(/\s/g, '')) : null

        payload = {  // assign (not declare)
            data: [{
                event_name: 'Purchase',
                event_time: Math.floor(Date.now() / 1000),
                event_id: eventId,
                event_source_url: session.lt_landing || session.ft_landing,
                action_source: 'website',
                user_data: {
                    em: hashedEmail ? [hashedEmail] : undefined,
                    ph: hashedPhone ? [hashedPhone] : undefined,
                    fbc: session.fbc || undefined,
                    fbp: session.fbp || undefined,
                    client_ip_address: session.ip_hash || undefined,
                    client_user_agent: session.user_agent || undefined,
                    country: hashedCountry ? [hashedCountry] : undefined,
                    ct: hashedCity ? [hashedCity] : undefined,
                },
                custom_data: {
                    value: order.total,
                    currency: order.currency || 'CZK',
                    content_ids: order.items?.map((i: any) => i.id) || [],
                    content_type: 'product',
                    num_items: order.items?.length || 1,
                    contents: order.items?.map((i: any) => ({
                        id: i.id,
                        quantity: i.quantity,
                        item_price: i.price,
                    })),
                },
            }],
            ...(testEventCode && { test_event_code: testEventCode }),
        }

        const response = await fetch(
            `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${accessToken}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        )

        const result = await response.json()

        return {
            success: response.ok && !result.error,
            response: result,
            payload,  // add
        }

    } catch (error) {
        console.error('Facebook CAPI error:', error)
        return { success: false, error, payload }  // add payload
    }
}
```

### Step 2: Apply the same pattern to facebook-lead.ts

Same 3-line change in `sendLeadToFacebook`:
- `let payload: Record<string, any> | undefined` before try
- `payload = { ... }` instead of `const payload = { ... }` inside try  
- Add `payload` to both return statements

### Step 3: Apply the same pattern to google.ts

Same 3-line change in `sendToGoogle`.

Note: the Google payload structure is:
```typescript
payload = {
    client_id: session.ga_client_id || session.session_id,
    events: [{ name: 'purchase', params: { ... } }],
    user_data: { ... },
}
```

### Step 4: Apply the same pattern to google-lead.ts

Same 3-line change in `sendLeadToGoogle`.

### Step 5: Verify TypeScript compiles

```bash
npx tsc --noEmit
```

**Expected:** no errors.

### Step 6: Commit

```bash
git add src/lib/forwarding/
git commit -m "feat: include payload in forwarding results for retry queue"
```

---

## Task 4: Queue helper function

**Files:**
- Create: `src/lib/forwarding/queue.ts`

### Step 1: Create the file

```typescript
// src/lib/forwarding/queue.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// Exponential backoff delays in seconds: 1m, 5m, 30m, 2h, 12h, 24h
export const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 43200, 86400]
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length

export function nextRetryDelay(attempts: number): number {
  return RETRY_DELAYS_SECONDS[Math.min(attempts, RETRY_DELAYS_SECONDS.length - 1)]
}

export async function enqueueFailedForwarding({
  clientId,
  eventType,
  eventId,
  platform,
  payload,
  error,
}: {
  clientId: string
  eventType: 'lead' | 'order'
  eventId: string
  platform: 'facebook' | 'google'
  payload: Record<string, any>
  error?: string
}): Promise<void> {
  const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_SECONDS[0] * 1000).toISOString()

  const { error: dbError } = await supabase.from('forwarding_queue').insert({
    client_id: clientId,
    event_type: eventType,
    event_id: eventId,
    platform,
    payload,
    status: 'pending',
    attempts: 0,
    next_retry_at: nextRetryAt,
    last_error: error ?? null,
  })

  if (dbError) {
    console.error('[Queue] Failed to enqueue forwarding:', dbError)
  }
}
```

### Step 2: Verify TypeScript compiles

```bash
npx tsc --noEmit
```

### Step 3: Commit

```bash
git add src/lib/forwarding/queue.ts
git commit -m "feat: add enqueueFailedForwarding helper with exponential backoff intervals"
```

---

## Task 5: Lead webhook — enqueue on failure

**Files:**
- Modify: `src/app/api/webhook/lead/route.ts`

### Step 1: Add import at the top

```typescript
import { enqueueFailedForwarding } from '@/lib/forwarding/queue'
```

### Step 2: Enqueue when Facebook forward fails

Find the `if (fbResult?.success)` block and add an `else if` branch:

```typescript
if (fbResult?.success) {
    await supabase.from('leads')
        .update({ sent_to_facebook: true })
        .eq('client_id', CLIENT_ID)
        .eq('external_lead_id', lead.external_id)
} else if (fbResult && !fbResult.success && fbResult.payload) {
    await enqueueFailedForwarding({
        clientId: CLIENT_ID,
        eventType: 'lead',
        eventId,
        platform: 'facebook',
        payload: fbResult.payload,
        error: String(fbResult.response?.error?.message || fbResult.error || 'unknown'),
    })
}
```

### Step 3: Enqueue when Google forward fails

Find the `if (googleResult?.success)` block and add the same pattern:

```typescript
if (googleResult?.success) {
    await supabase.from('leads')
        .update({ sent_to_google: true })
        .eq('client_id', CLIENT_ID)
        .eq('external_lead_id', lead.external_id)
} else if (googleResult && !googleResult.success && googleResult.payload) {
    await enqueueFailedForwarding({
        clientId: CLIENT_ID,
        eventType: 'lead',
        eventId,
        platform: 'google',
        payload: googleResult.payload,
        error: String(googleResult.error || 'unknown'),
    })
}
```

### Step 4: Verify TypeScript compiles

```bash
npx tsc --noEmit
```

### Step 5: Commit

```bash
git add src/app/api/webhook/lead/route.ts
git commit -m "feat: enqueue failed Facebook/Google forwards from lead webhook"
```

---

## Task 6: Order webhook — enqueue on failure

**Files:**
- Modify: `src/app/api/webhook/order/route.ts`

### Step 1: Add import

```typescript
import { enqueueFailedForwarding } from '@/lib/forwarding/queue'
```

### Step 2: Enqueue when Facebook forward fails

Find the existing `if (fbResult?.success)` block in the order webhook and apply the same pattern as Task 5. Use `order.external_id` as `eventId`:

```typescript
if (fbResult?.success) {
    await supabase.from('orders')
        .update({ sent_to_facebook: true })
        .eq('client_id', CLIENT_ID)
        .eq('external_order_id', order.external_id)
} else if (fbResult && !fbResult.success && fbResult.payload) {
    await enqueueFailedForwarding({
        clientId: CLIENT_ID,
        eventType: 'order',
        eventId: order.external_id,
        platform: 'facebook',
        payload: fbResult.payload,
        error: String(fbResult.response?.error?.message || fbResult.error || 'unknown'),
    })
}
```

### Step 3: Enqueue when Google forward fails

```typescript
if (googleResult?.success) {
    await supabase.from('orders')
        .update({ sent_to_google: true })
        .eq('client_id', CLIENT_ID)
        .eq('external_order_id', order.external_id)
} else if (googleResult && !googleResult.success && googleResult.payload) {
    await enqueueFailedForwarding({
        clientId: CLIENT_ID,
        eventType: 'order',
        eventId: order.external_id,
        platform: 'google',
        payload: googleResult.payload,
        error: String(googleResult.error || 'unknown'),
    })
}
```

### Step 4: Verify TypeScript compiles

```bash
npx tsc --noEmit
```

### Step 5: Commit

```bash
git add src/app/api/webhook/order/route.ts
git commit -m "feat: enqueue failed Facebook/Google forwards from order webhook"
```

---

## Task 7: Retry cron endpoint

**Files:**
- Create: `src/app/api/cron/retry-queue/route.ts`
- Create: `vercel.json`

### Step 1: Add CRON_SECRET to .env.local

```
CRON_SECRET=generate-a-strong-random-string-here
```

Generate one with: `openssl rand -base64 32`

### Step 2: Create the retry endpoint

```typescript
// src/app/api/cron/retry-queue/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { MAX_ATTEMPTS, nextRetryDelay } from '@/lib/forwarding/queue'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// Vercel cron calls this with Authorization: Bearer <CRON_SECRET>
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  const { data: items, error } = await supabase
    .from('forwarding_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('next_retry_at', now)
    .order('next_retry_at', { ascending: true })
    .limit(50)

  if (error) {
    console.error('[RetryQueue] DB fetch error:', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  const results = { sent: 0, failed: 0, dead: 0 }

  for (const item of items ?? []) {
    const newAttempts = item.attempts + 1

    try {
      const { data: clientData } = await supabase
        .from('clients')
        .select('settings')
        .eq('client_id', item.client_id)
        .single()

      let endpoint: string

      if (item.platform === 'facebook') {
        const fb = clientData?.settings?.facebook
        if (!fb?.pixel_id || !fb?.access_token) {
          await markDead(item.id, 'Missing Facebook credentials')
          results.dead++
          continue
        }
        endpoint = `https://graph.facebook.com/v18.0/${fb.pixel_id}/events?access_token=${fb.access_token}`
        // Inject test_event_code if configured (for staging clients)
        if (fb.test_event_code && item.payload.data) {
          item.payload.test_event_code = fb.test_event_code
        }
      } else {
        const google = clientData?.settings?.google
        if (!google?.measurement_id || !google?.api_secret) {
          await markDead(item.id, 'Missing Google credentials')
          results.dead++
          continue
        }
        endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${google.measurement_id}&api_secret=${google.api_secret}`
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload),
      })

      const responseText = await response.text()

      if (response.ok) {
        await supabase.from('forwarding_queue')
          .update({ status: 'sent', attempts: newAttempts, updated_at: new Date().toISOString() })
          .eq('id', item.id)

        // Update the original lead/order so dashboard shows it as sent
        const table = item.event_type === 'lead' ? 'leads' : 'orders'
        const idField = item.event_type === 'lead' ? 'external_lead_id' : 'external_order_id'
        const sentField = item.platform === 'facebook' ? 'sent_to_facebook' : 'sent_to_google'
        await supabase.from(table)
          .update({ [sentField]: true })
          .eq('client_id', item.client_id)
          .eq(idField, item.event_id)

        results.sent++
        console.log(`[RetryQueue] Sent ${item.platform} ${item.event_type} ${item.event_id}`)
      } else {
        await handleFailure(item.id, newAttempts, `HTTP ${response.status}: ${responseText.slice(0, 200)}`)
        results.failed++
      }

    } catch (err) {
      await handleFailure(item.id, newAttempts, String(err))
      results.failed++
    }
  }

  console.log(`[RetryQueue] Processed ${items?.length ?? 0} items:`, results)
  return NextResponse.json({ ok: true, processed: items?.length ?? 0, ...results })
}

async function handleFailure(id: string, attempts: number, errorMsg: string) {
  if (attempts >= MAX_ATTEMPTS) {
    await markDead(id, errorMsg)
    return
  }
  const delaySeconds = nextRetryDelay(attempts)
  const nextRetryAt = new Date(Date.now() + delaySeconds * 1000).toISOString()
  await supabase.from('forwarding_queue').update({
    status: 'pending',
    attempts,
    next_retry_at: nextRetryAt,
    last_error: errorMsg,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
}

async function markDead(id: string, errorMsg: string) {
  await supabase.from('forwarding_queue').update({
    status: 'dead',
    last_error: errorMsg,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
}
```

### Step 3: Create vercel.json

```json
{
  "crons": [
    {
      "path": "/api/cron/retry-queue",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

### Step 4: Verify endpoint locally

```bash
curl -X GET "http://localhost:3000/api/cron/retry-queue" \
  -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

**Expected:** `{"ok":true,"processed":0,"sent":0,"failed":0,"dead":0}`

### Step 5: Verify retry logic works end-to-end

Insert a test item with a bad payload (will fail to send):

```sql
INSERT INTO forwarding_queue (client_id, event_type, event_id, platform, payload, status, attempts, next_retry_at)
VALUES (
  'your-client-id',
  'lead',
  'test-retry-001',
  'facebook',
  '{"data":[{"event_name":"Lead","event_time":0}]}'::jsonb,
  'pending',
  0,
  NOW() - INTERVAL '1 minute'
);
```

Hit the endpoint, then check the result:

```sql
SELECT id, status, attempts, next_retry_at, last_error 
FROM forwarding_queue 
WHERE event_id = 'test-retry-001';
```

**Expected:** `attempts = 1`, `status = 'pending'`, `next_retry_at` is ~5 minutes in the future (second retry delay), `last_error` contains the HTTP error. Clean up: `DELETE FROM forwarding_queue WHERE event_id = 'test-retry-001';`

### Step 6: Commit

```bash
git add src/app/api/cron/retry-queue/route.ts vercel.json
git commit -m "feat: retry cron with exponential backoff (1m→5m→30m→2h→12h→24h)"
```

---

## Task 8: Volume drop alerting cron

**Files:**
- Create: `src/app/api/cron/volume-alert/route.ts`
- Modify: `vercel.json`

### Step 1: Add env var to .env.local

```
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/halotrack-alerts
```

This is the n8n webhook URL. You'll set up the Telegram step in n8n (see Step 5).

### Step 2: Create the alert endpoint

```typescript
// src/app/api/cron/volume-alert/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: clients, error: clientError } = await supabase
    .from('clients')
    .select('client_id, name')
    .eq('active', true)

  if (clientError || !clients) {
    return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
  }

  const alerts: Array<{
    client: string
    client_id: string
    severity: 'critical' | 'warning'
    type: string
    message: string
  }> = []

  for (const client of clients) {
    const now = new Date()
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Leads in last 6h (current window)
    const { count: currentCount } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.client_id)
      .gte('created_at', sixHoursAgo.toISOString())

    // 7-day total ÷ 28 = per-6h average
    const { count: weekCount } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.client_id)
      .gte('created_at', sevenDaysAgo.toISOString())

    const sevenDayAvgPer6h = (weekCount ?? 0) / 28
    const current = currentCount ?? 0

    if (current === 0 && sevenDayAvgPer6h > 0) {
      alerts.push({
        client: client.name,
        client_id: client.client_id,
        severity: 'critical',
        type: 'zero_leads',
        message: `ZERO leads in last 6h (7-day avg: ${sevenDayAvgPer6h.toFixed(1)}/6h)`,
      })
    } else if (sevenDayAvgPer6h > 0 && current < sevenDayAvgPer6h * 0.5) {
      alerts.push({
        client: client.name,
        client_id: client.client_id,
        severity: 'warning',
        type: 'low_volume',
        message: `Low lead volume: ${current} in last 6h (7-day avg: ${sevenDayAvgPer6h.toFixed(1)}/6h, ${Math.round(current / sevenDayAvgPer6h * 100)}% of normal)`,
      })
    }

    // sent_to_facebook=false ratio in last 24h (only flag if ≥3 leads for statistical relevance)
    const { count: totalLast24h } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.client_id)
      .gte('created_at', oneDayAgo.toISOString())

    const { count: notSentFb } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.client_id)
      .eq('sent_to_facebook', false)
      .gte('created_at', oneDayAgo.toISOString())

    const total24h = totalLast24h ?? 0
    const fbFailRate = total24h >= 3 ? (notSentFb ?? 0) / total24h : 0

    if (fbFailRate > 0.3) {
      alerts.push({
        client: client.name,
        client_id: client.client_id,
        severity: 'warning',
        type: 'fb_forward_failures',
        message: `${Math.round(fbFailRate * 100)}% of leads NOT sent to Facebook in last 24h (${notSentFb}/${total24h})`,
      })
    }

    // match_type='none' ratio in last 24h
    const { count: unmatchedCount } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.client_id)
      .eq('match_type', 'none')
      .gte('created_at', oneDayAgo.toISOString())

    const unmatchedRate = total24h >= 3 ? (unmatchedCount ?? 0) / total24h : 0

    if (unmatchedRate > 0.5) {
      alerts.push({
        client: client.name,
        client_id: client.client_id,
        severity: 'warning',
        type: 'attribution_gap',
        message: `${Math.round(unmatchedRate * 100)}% of leads unmatched to sessions in last 24h (${unmatchedCount}/${total24h})`,
      })
    }
  }

  if (alerts.length > 0 && process.env.N8N_WEBHOOK_URL) {
    await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alerts, timestamp: new Date().toISOString() }),
    }).catch(err => console.error('[VolumeAlert] n8n webhook failed:', err))
  }

  console.log(`[VolumeAlert] Checked ${clients.length} clients, fired ${alerts.length} alerts`)
  return NextResponse.json({ ok: true, clients: clients.length, alerts })
}
```

### Step 3: Update vercel.json to add volume alert schedule

```json
{
  "crons": [
    {
      "path": "/api/cron/retry-queue",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/cron/volume-alert",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

### Step 4: Verify endpoint locally

```bash
curl -X GET "http://localhost:3000/api/cron/volume-alert" \
  -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

**Expected:** `{"ok":true,"clients":N,"alerts":[]}` (no alerts if recent leads exist).

Cross-check with Supabase:

```sql
SELECT client_id, COUNT(*) as leads_last_6h
FROM leads
WHERE created_at > NOW() - INTERVAL '6 hours'
GROUP BY client_id;
```

If this shows leads for all active clients, no `zero_leads` alert should fire. Confirm the endpoint output matches.

### Step 5: Set up n8n Telegram routing (manual step — not code)

In n8n:
1. Create a new workflow
2. Webhook trigger node — set the URL and copy it to `N8N_WEBHOOK_URL` in `.env.local`
3. Telegram node — message body:
   ```
   {{ $json.alerts.map(a => `[${a.severity.toUpperCase()}] ${a.client}\n${a.message}`).join('\n\n') }}
   ```
4. Activate the workflow

### Step 6: Commit

```bash
git add src/app/api/cron/volume-alert/route.ts vercel.json
git commit -m "feat: volume drop alerting cron with zero/low/fb-fail/unmatched checks"
```

---

## Task 9: Signal health server action + types

**Files:**
- Modify: `src/types/dashboard.ts`
- Create: `src/app/actions/signal-health.ts`

### Step 1: Add SignalHealthMetric and SignalHealthData to src/types/dashboard.ts

Add at the end of the file:

```typescript
export interface SignalHealthMetric {
  sent: number    // count that passed (sent, matched, etc.)
  total: number   // total in period
  rate: number    // sent / total (0–1); higher is always better
}

export interface SignalHealthData {
  fbLeads: SignalHealthMetric       // leads sent_to_facebook=true
  googleLeads: SignalHealthMetric   // leads sent_to_google=true
  matchRate: SignalHealthMetric     // leads where match_type != 'none'
  gaClientId: SignalHealthMetric    // sessions with ga_client_id != null
  fbc: SignalHealthMetric           // sessions with fbc != null
  country: SignalHealthMetric       // sessions with country != null
  queuedRetries: number             // pending items in forwarding_queue
  deadItems: number                 // dead items needing manual intervention
}
```

### Step 2: Create the server action

```typescript
// src/app/actions/signal-health.ts
'use server'

import { createClient } from '@supabase/supabase-js'
import type { SignalHealthData, SignalHealthMetric } from '@/types/dashboard'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function getSignalHealth(clientId: string): Promise<SignalHealthData> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  function metric(sent: number, total: number): SignalHealthMetric {
    return { sent, total, rate: total > 0 ? sent / total : 1 }
  }

  // --- Leads ---
  const { count: totalLeads } = await supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).gte('created_at', thirtyDaysAgo)

  const { count: fbSent } = await supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('sent_to_facebook', true).gte('created_at', thirtyDaysAgo)

  const { count: googleSent } = await supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('sent_to_google', true).gte('created_at', thirtyDaysAgo)

  const { count: unmatchedCount } = await supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('match_type', 'none').gte('created_at', thirtyDaysAgo)

  const total = totalLeads ?? 0

  // --- Sessions ---
  const { count: totalSessions } = await supabase
    .from('sessions').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).gte('created_at', thirtyDaysAgo)

  const { count: gaCount } = await supabase
    .from('sessions').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).not('ga_client_id', 'is', null).gte('created_at', thirtyDaysAgo)

  const { count: fbcCount } = await supabase
    .from('sessions').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).not('fbc', 'is', null).gte('created_at', thirtyDaysAgo)

  const { count: countryCount } = await supabase
    .from('sessions').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).not('country', 'is', null).gte('created_at', thirtyDaysAgo)

  const sessions = totalSessions ?? 0

  // --- Queue ---
  const { count: queuedRetries } = await supabase
    .from('forwarding_queue').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('status', 'pending')

  const { count: deadItems } = await supabase
    .from('forwarding_queue').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('status', 'dead')

  return {
    fbLeads: metric(fbSent ?? 0, total),
    googleLeads: metric(googleSent ?? 0, total),
    matchRate: metric(total - (unmatchedCount ?? 0), total),
    gaClientId: metric(gaCount ?? 0, sessions),
    fbc: metric(fbcCount ?? 0, sessions),
    country: metric(countryCount ?? 0, sessions),
    queuedRetries: queuedRetries ?? 0,
    deadItems: deadItems ?? 0,
  }
}
```

### Step 3: Verify TypeScript compiles

```bash
npx tsc --noEmit
```

### Step 4: Cross-check action output against raw SQL

```sql
SELECT 
  COUNT(*) AS total_leads,
  COUNT(*) FILTER (WHERE sent_to_facebook = true) AS fb_sent,
  COUNT(*) FILTER (WHERE sent_to_google = true) AS google_sent,
  COUNT(*) FILTER (WHERE match_type = 'none') AS unmatched
FROM leads
WHERE client_id = 'your-client-id'
  AND created_at > NOW() - INTERVAL '30 days';
```

Numbers should match what the action returns (verify after wiring into dashboard in Task 11).

### Step 5: Commit

```bash
git add src/types/dashboard.ts src/app/actions/signal-health.ts
git commit -m "feat: signal health server action with forwarding and match rate metrics"
```

---

## Task 10: SignalHealth dashboard component

**Files:**
- Create: `src/app/dashboard/components/SignalHealth.tsx`

### Step 1: Create the component

```tsx
// src/app/dashboard/components/SignalHealth.tsx
'use client'

import type { SignalHealthData, SignalHealthMetric } from '@/types/dashboard'
import { AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react'

interface SignalHealthProps {
  data: SignalHealthData
}

function healthBg(rate: number): string {
  if (rate >= 0.9) return 'bg-green-50 border-green-200'
  if (rate >= 0.7) return 'bg-yellow-50 border-yellow-200'
  return 'bg-red-50 border-red-200'
}

function healthTextColor(rate: number): string {
  if (rate >= 0.9) return 'text-green-700'
  if (rate >= 0.7) return 'text-yellow-700'
  return 'text-red-700'
}

function StatusIcon({ rate }: { rate: number }) {
  if (rate >= 0.9) return <CheckCircle className="h-4 w-4 text-green-600" />
  if (rate >= 0.7) return <AlertTriangle className="h-4 w-4 text-yellow-600" />
  return <AlertCircle className="h-4 w-4 text-red-600" />
}

function HealthMetric({ label, metric }: { label: string; metric: SignalHealthMetric }) {
  const pct = metric.total > 0 ? Math.round(metric.rate * 100) : 100

  return (
    <div className={`rounded-lg border p-4 ${healthBg(metric.rate)}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <StatusIcon rate={metric.rate} />
      </div>
      <div className={`text-2xl font-bold ${healthTextColor(metric.rate)}`}>
        {pct}%
      </div>
      <div className="text-xs text-gray-500 mt-1">
        {metric.sent} / {metric.total}
      </div>
    </div>
  )
}

export function SignalHealth({ data }: SignalHealthProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xl font-bold">Signal Health</h4>
        <span className="text-xs text-gray-500">Last 30 days</span>
      </div>

      {data.deadItems > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <span className="text-sm text-red-800">
            <strong>{data.deadItems}</strong> forwarding{data.deadItems === 1 ? '' : 's'} permanently failed — query{' '}
            <code className="font-mono text-xs">forwarding_queue WHERE status = 'dead'</code> for details
          </span>
        </div>
      )}

      {data.queuedRetries > 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
          <span className="text-sm text-yellow-800">
            <strong>{data.queuedRetries}</strong> conversion{data.queuedRetries === 1 ? '' : 's'} queued for retry
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <HealthMetric label="Leads → Facebook" metric={data.fbLeads} />
        <HealthMetric label="Leads → Google" metric={data.googleLeads} />
        <HealthMetric label="Session Match" metric={data.matchRate} />
        <HealthMetric label="GA Client ID" metric={data.gaClientId} />
        <HealthMetric label="Facebook fbc" metric={data.fbc} />
        <HealthMetric label="Geo (Country)" metric={data.country} />
      </div>
    </div>
  )
}
```

### Step 2: Verify TypeScript compiles

```bash
npx tsc --noEmit
```

### Step 3: Commit

```bash
git add src/app/dashboard/components/SignalHealth.tsx
git commit -m "feat: SignalHealth component with green/yellow/red forwarding metrics"
```

---

## Task 11: Wire SignalHealth into DashboardClient

**Files:**
- Modify: `src/app/dashboard/components/DashboardClient.tsx`

### Step 1: Add imports at the top of the file (after existing imports)

```typescript
import { getSignalHealth } from '@/app/actions/signal-health'
import { SignalHealth } from './SignalHealth'
import type { SignalHealthData } from '@/types/dashboard'
```

### Step 2: Add state

Inside `DashboardClient`, after the existing `useState` declarations, add:

```typescript
const [signalHealth, setSignalHealth] = useState<SignalHealthData | null>(null)
```

### Step 3: Add a separate useEffect to load signal health

Signal health doesn't change with the date range — it always shows the last 30 days. Add a separate effect after the existing `useEffect`:

```typescript
useEffect(() => {
  getSignalHealth(clientId).then(setSignalHealth)
}, [clientId])
```

### Step 4: Add SignalHealth to JSX

After the closing `</div>` of the Purchases section (but before the `isLoading` spinner), add:

```tsx
{signalHealth && (
  <div className="border-t pt-8">
    <SignalHealth data={signalHealth} />
  </div>
)}
```

### Step 5: Test in browser

```bash
npm run dev
```

1. Navigate to `http://localhost:3000/dashboard`
2. Scroll to the bottom — Signal Health panel should appear
3. Verify metrics show correct percentages (compare to the SQL query from Task 9 Step 4)
4. Verify green/yellow/red colors match the thresholds (≥90% green, 70–89% yellow, <70% red)
5. Check browser console — no errors

### Step 6: Verify TypeScript compiles

```bash
npx tsc --noEmit
```

**Expected:** no errors.

### Step 7: Commit

```bash
git add src/app/dashboard/components/DashboardClient.tsx
git commit -m "feat: add Signal Health panel to dashboard bottom"
```

---

## Post-implementation verification

Run these queries in Supabase after the first real lead comes in with the new code deployed:

```sql
-- 1. Confirm forwarding_queue exists and is empty (no failures yet)
SELECT status, COUNT(*) FROM forwarding_queue GROUP BY status;

-- 2. Confirm leads still have correct sent_to_facebook / sent_to_google values
SELECT sent_to_facebook, sent_to_google, COUNT(*)
FROM leads
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY sent_to_facebook, sent_to_google;

-- 3. Confirm volume alert logic: should produce no alerts for an active client
-- (Run the cron endpoint manually and verify alerts array is empty)
```

---

## Plan complete and saved to `docs/plans/2026-04-16-tier1-reliability.md`.

Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open a new session in this project with the executing-plans skill, batch execution with checkpoints

Which approach?
