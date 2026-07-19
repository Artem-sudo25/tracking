// src/app/api/export/google-conversions/route.ts
// Secured CSV endpoint that Google Ads pulls on a daily schedule (Tools →
// Conversions → Uploads → Schedule → HTTPS). Returns offline click conversions
// for a rolling window so late-settling orders are caught — Google de-dupes
// re-sends by gclid+name+time, so overlap is safe.
//
// Auth: HTTP Basic Auth (password = GOOGLE_EXPORT_KEY; username ignored) — this
// is what Google Ads' scheduled HTTPS upload sends. Also accepts ?key=<…> as a
// fallback for browser testing. Serves this deployment's CLIENT_ID only.
// Reachable at both /api/export/google-conversions and …google-conversions.csv
// (Google's importer requires a .csv/.tsv URL — see the rewrite in next.config).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildGoogleConversionsCsv, type RawConversion } from '@/lib/google-conversions'
import { isAuthorized, resolveWindow } from '@/lib/google-export-auth'
import { fetchConsentBySession } from '@/lib/session-consent'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

const DEFAULT_DAYS = 7

export async function GET(request: NextRequest) {
    if (!isAuthorized(request, process.env.GOOGLE_EXPORT_KEY)) {
        return new NextResponse('Unauthorized', {
            status: 401,
            headers: { 'WWW-Authenticate': 'Basic realm="halotrack"' },
        })
    }

    const { since } = resolveWindow(request, DEFAULT_DAYS)
    const conversionName =
        request.nextUrl.searchParams.get('name') || 'HaloTrack Purchase'

    // Client type decides the source table (mirrors the dashboard convention).
    const { data: clientRow } = await supabase
        .from('clients')
        .select('settings')
        .eq('client_id', CLIENT_ID)
        .single()
    const clientType = clientRow?.settings?.client_type ?? 'ecommerce'
    const useLeads = clientType === 'leads' || clientType === 'bookings'

    const records: RawConversion[] = []

    if (useLeads) {
        const { data, error } = await supabase
            .from('leads')
            .select('external_lead_id, lead_value, currency, created_at, session_id, attribution_data')
            .eq('client_id', CLIENT_ID)
            .gte('created_at', since)
            .order('created_at', { ascending: true })
        if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
        for (const l of data ?? []) {
            records.push({
                externalId: l.external_lead_id,
                value: l.lead_value,
                currency: l.currency,
                createdAt: l.created_at,
                sessionId: l.session_id ?? l.attribution_data?.session_id ?? null,
                clickIds: l.attribution_data?.click_ids ?? {},
            })
        }
    } else {
        const { data, error } = await supabase
            .from('orders')
            .select('external_order_id, total_amount, currency, created_at, session_id, attribution_data')
            .eq('client_id', CLIENT_ID)
            .gte('created_at', since)
            .order('created_at', { ascending: true })
        if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
        for (const o of data ?? []) {
            records.push({
                externalId: o.external_order_id,
                value: o.total_amount,
                currency: o.currency,
                createdAt: o.created_at,
                sessionId: o.session_id ?? o.attribution_data?.session_id ?? null,
                clickIds: o.attribution_data?.click_ids ?? {},
            })
        }
    }

    const consentBySession = await fetchConsentBySession(supabase, CLIENT_ID, records.map(r => r.sessionId))
    for (const r of records) {
        r.consent = r.sessionId ? consentBySession.get(r.sessionId) ?? null : null
    }
    const { csv } = buildGoogleConversionsCsv(records, conversionName)

    return new NextResponse(csv, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Disposition': 'inline; filename="google-conversions.csv"',
        },
    })
}
