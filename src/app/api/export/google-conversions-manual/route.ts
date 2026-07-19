// src/app/api/export/google-conversions-manual/route.ts
// Secured CSV endpoint for the MANUAL push feed — a separate Google Ads
// conversion action from the automatic one served by
// src/app/api/export/google-conversions/route.ts. Only leads a dashboard user
// explicitly pushed (leads.manual_google_push_at IS NOT NULL, set via
// pushLeadToGoogleAds in src/app/actions/dashboard.ts) appear here; nothing
// is included automatically.
//
// Windowing: filtered/ordered by manual_google_push_updated_at (bumped on
// every push AND every later value edit), NOT manual_google_push_at (which is
// set once and frozen — it's what's sent to Google as Conversion Time, for
// dedup stability). Windowing on the frozen field would mean editing an old
// push's value long after the original push falls outside the window and
// never reaches Google again.
//
// Consent: this feed is NOT consent-aware (buildGoogleConversionsCsv is
// called with unsafeSkipConsentGate: true) — an explicit, per-lead human
// decision made in the dashboard UI (which surfaces each lead's consent state
// so the user can judge it before pushing), not a blind bulk export. See the
// consent columns comment in google-conversions.ts — this option must never
// be reused for an unattended/scheduled feed.
//
// Auth: same Basic Auth / ?key= pattern as the automatic feed, reusing
// GOOGLE_EXPORT_KEY (same trust boundary) via src/lib/google-export-auth.
// Reachable at both /api/export/google-conversions-manual and …-manual.csv
// (see next.config.ts rewrite — Google's importer requires a .csv/.tsv URL).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildGoogleConversionsCsv, type RawConversion } from '@/lib/google-conversions'
import { isAuthorized, resolveWindow } from '@/lib/google-export-auth'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

const DEFAULT_DAYS = 30

export async function GET(request: NextRequest) {
    if (!isAuthorized(request, process.env.GOOGLE_EXPORT_KEY)) {
        return new NextResponse('Unauthorized', {
            status: 401,
            headers: { 'WWW-Authenticate': 'Basic realm="halotrack"' },
        })
    }

    const { since } = resolveWindow(request, DEFAULT_DAYS)
    const conversionName =
        request.nextUrl.searchParams.get('name') || 'HaloTrack Manual Push'

    const { data, error } = await supabase
        .from('leads')
        .select('external_lead_id, manual_google_push_value, currency, manual_google_push_at, manual_google_push_updated_at, session_id, attribution_data')
        .eq('client_id', CLIENT_ID)
        .not('manual_google_push_at', 'is', null)
        .gte('manual_google_push_updated_at', since)
        .order('manual_google_push_updated_at', { ascending: true })

    if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })

    const records: RawConversion[] = (data ?? []).map(l => ({
        externalId: l.external_lead_id,
        value: l.manual_google_push_value,
        currency: l.currency,
        createdAt: l.manual_google_push_at as string,
        sessionId: l.session_id ?? l.attribution_data?.session_id ?? null,
        clickIds: l.attribution_data?.click_ids ?? {},
    }))

    const { csv } = buildGoogleConversionsCsv(records, conversionName, new Set(), { unsafeSkipConsentGate: true })

    return new NextResponse(csv, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Disposition': 'inline; filename="google-conversions-manual.csv"',
        },
    })
}
