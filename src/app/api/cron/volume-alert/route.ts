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
    current?: number        // current count in the measured window
    historical_avg?: number // 7-day per-6h average (volume alerts)
    rate?: number           // failure rate 0–1 (ratio alerts)
    total?: number          // denominator (ratio alerts)
  }> = []

  for (const client of clients) {
    const now = new Date()
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // --- Volume check ---
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
        current,
        historical_avg: parseFloat(sevenDayAvgPer6h.toFixed(2)),
      })
    } else if (sevenDayAvgPer6h > 0 && current < sevenDayAvgPer6h * 0.5) {
      alerts.push({
        client: client.name,
        client_id: client.client_id,
        severity: 'warning',
        type: 'low_volume',
        message: `Low lead volume: ${current} in last 6h (7-day avg: ${sevenDayAvgPer6h.toFixed(1)}/6h, ${Math.round(current / sevenDayAvgPer6h * 100)}% of normal)`,
        current,
        historical_avg: parseFloat(sevenDayAvgPer6h.toFixed(2)),
      })
    }

    // --- sent_to_facebook=false ratio (last 24h, min 3 leads for statistical relevance) ---
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
        current: notSentFb ?? 0,
        total: total24h,
        rate: parseFloat(fbFailRate.toFixed(3)),
      })
    }

    // --- match_type='none' ratio (last 24h, min 3 leads) ---
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
        current: unmatchedCount ?? 0,
        total: total24h,
        rate: parseFloat(unmatchedRate.toFixed(3)),
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
