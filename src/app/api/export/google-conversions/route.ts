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

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

const DEFAULT_DAYS = 7
const MAX_DAYS = 90

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

// The provided secret can arrive two ways: ?key=… (browser test) or HTTP Basic
// Auth (what Google Ads' scheduled HTTPS upload sends). For Basic Auth we check
// the password component against GOOGLE_EXPORT_KEY; the username is ignored.
function extractProvidedKey(request: NextRequest): string {
    const fromQuery = request.nextUrl.searchParams.get('key')
    if (fromQuery) return fromQuery

    const auth = request.headers.get('authorization') ?? ''
    if (auth.startsWith('Basic ')) {
        try {
            const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
            const sep = decoded.indexOf(':')
            return sep >= 0 ? decoded.slice(sep + 1) : decoded
        } catch {
            return ''
        }
    }
    return ''
}

// Collect the session ids whose consent was later set to 'denied', so their
// conversions are excluded (granted + unknown remain uploadable).
async function deniedSessionIds(sessionIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(sessionIds.filter(Boolean))]
    if (ids.length === 0) return new Set()

    const { data } = await supabase
        .from('sessions')
        .select('session_id')
        .eq('client_id', CLIENT_ID)
        .eq('consent_status', 'denied')
        .in('session_id', ids)

    return new Set((data ?? []).map(r => r.session_id))
}

export async function GET(request: NextRequest) {
    const key = process.env.GOOGLE_EXPORT_KEY
    const provided = extractProvidedKey(request)
    if (!key || !provided || !timingSafeEqual(provided, key)) {
        return new NextResponse('Unauthorized', {
            status: 401,
            headers: { 'WWW-Authenticate': 'Basic realm="halotrack"' },
        })
    }

    const daysParam = parseInt(request.nextUrl.searchParams.get('days') ?? '', 10)
    const days = Number.isFinite(daysParam)
        ? Math.min(Math.max(daysParam, 1), MAX_DAYS)
        : DEFAULT_DAYS
    const conversionName =
        request.nextUrl.searchParams.get('name') || 'HaloTrack Purchase'

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

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
            .select('external_lead_id, lead_value, currency, created_at, session_id, email, phone, attribution_data')
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
                email: l.email,
                phone: l.phone,
            })
        }
    } else {
        const { data, error } = await supabase
            .from('orders')
            .select('external_order_id, total_amount, currency, created_at, session_id, customer_email, customer_phone, attribution_data')
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
                email: o.customer_email,
                phone: o.customer_phone,
            })
        }
    }

    const denied = await deniedSessionIds(records.map(r => r.sessionId ?? ''))
    const { csv } = buildGoogleConversionsCsv(records, conversionName, denied)

    return new NextResponse(csv, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Disposition': 'inline; filename="google-conversions.csv"',
        },
    })
}
