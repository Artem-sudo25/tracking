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
        // Preserve test_event_code for staging clients
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
