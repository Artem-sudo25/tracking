'use server'

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

// ─── Hashing helpers (Meta requires SHA-256 lowercase) ────────────────────────

function sha256(value: string): string {
    return createHash('sha256').update(value.toLowerCase().trim()).digest('hex')
}

// Meta requires phone as digits only with country code, then SHA-256
function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '')
    // Czech mobile numbers are 9 digits — prepend country code
    if (digits.length === 9) return '420' + digits
    // Already has country code (e.g. 420777123456 or 00420...)
    if (digits.startsWith('00')) return digits.slice(2)
    return digits
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportResult {
    csv: string
    rowCount: number
    skippedCount: number
    filename: string
}

// ─── Meta Offline Conversions export ─────────────────────────────────────────
//
// Format: https://www.facebook.com/business/help/2545083282357336
// Required headers match Meta's CSV upload template exactly.
// PII fields (email, phone) must be SHA-256 hashed.
// fbc and fbp are NOT hashed — they are Meta's own identifiers.
// Only rows with at least one match signal (email OR fbc) are included.

export async function exportMetaConversions(
    clientId: string,
    startDate: string,
    endDate: string,
    failedOnly: boolean
): Promise<ExportResult> {

    let query = supabase
        .from('orders')
        .select('external_order_id, customer_email, customer_phone, total_amount, currency, created_at, sent_to_facebook, attribution_data')
        .eq('client_id', clientId)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: true })

    if (failedOnly) {
        query = query.eq('sent_to_facebook', false)
    }

    const { data, error } = await query

    if (error) throw new Error('Failed to fetch orders: ' + error.message)
    if (!data || data.length === 0) {
        return { csv: '', rowCount: 0, skippedCount: 0, filename: '' }
    }

    const headers = [
        'event_name',
        'event_time',
        'email',
        'phone',
        'fbc',
        'fbp',
        'value',
        'currency',
        'order_id',
    ]

    const rows: string[][] = []
    let skippedCount = 0

    for (const order of data) {
        const fbc: string = order.attribution_data?.click_ids?.fbc ?? ''
        const fbp: string = order.attribution_data?.click_ids?.fbp ?? ''
        const email: string = order.customer_email ?? ''
        const phone: string = order.customer_phone ?? ''

        // Skip rows with no usable match signal — Meta would reject them anyway
        if (!email && !fbc) {
            skippedCount++
            continue
        }

        const eventTime = Math.floor(new Date(order.created_at).getTime() / 1000)

        rows.push([
            'Purchase',
            String(eventTime),
            email ? sha256(email) : '',
            phone ? sha256(normalizePhone(phone)) : '',
            fbc,
            fbp,
            String(order.total_amount ?? ''),
            order.currency ?? 'CZK',
            order.external_order_id,
        ])
    }

    const csv = [
        headers.join(','),
        ...rows.map(row => row.map(escapeCsvCell).join(','))
    ].join('\n')

    const dateTag = formatDateTag(startDate, endDate)
    const suffix = failedOnly ? '-failed-only' : ''

    return {
        csv,
        rowCount: rows.length,
        skippedCount,
        filename: `meta-conversions-${dateTag}${suffix}.csv`,
    }
}

// ─── Google Ads Offline Conversions export ────────────────────────────────────
//
// Format: https://support.google.com/google-ads/answer/7014069
// Required: Google Click ID (gclid), Conversion Name, Conversion Time, Value, Currency.
// Only rows where gclid is present are included — without it Google cannot match.
// Conversion Time format: "yyyy-MM-dd HH:mm:ss+00:00" (UTC, RFC 3339-style).
// No hashing required — Google identifiers are not PII in this context.

export async function exportGoogleConversions(
    clientId: string,
    startDate: string,
    endDate: string,
    failedOnly: boolean,
    conversionName: string = 'Purchase'
): Promise<ExportResult> {

    let query = supabase
        .from('orders')
        .select('external_order_id, total_amount, currency, created_at, sent_to_google, attribution_data')
        .eq('client_id', clientId)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: true })

    if (failedOnly) {
        query = query.eq('sent_to_google', false)
    }

    const { data, error } = await query

    if (error) throw new Error('Failed to fetch orders: ' + error.message)
    if (!data || data.length === 0) {
        return { csv: '', rowCount: 0, skippedCount: 0, filename: '' }
    }

    const headers = [
        'Google Click ID',
        'Conversion Name',
        'Conversion Time',
        'Conversion Value',
        'Conversion Currency',
        'Order ID',
    ]

    const rows: string[][] = []
    let skippedCount = 0

    for (const order of data) {
        const gclid: string = order.attribution_data?.click_ids?.gclid ?? ''

        // Skip rows with no gclid — Google cannot match without it
        if (!gclid) {
            skippedCount++
            continue
        }

        rows.push([
            gclid,
            conversionName,
            formatGoogleTime(order.created_at),
            String(order.total_amount ?? ''),
            order.currency ?? 'CZK',
            order.external_order_id,
        ])
    }

    const csv = [
        headers.join(','),
        ...rows.map(row => row.map(escapeCsvCell).join(','))
    ].join('\n')

    const dateTag = formatDateTag(startDate, endDate)
    const suffix = failedOnly ? '-failed-only' : ''

    return {
        csv,
        rowCount: rows.length,
        skippedCount,
        filename: `google-conversions-${dateTag}${suffix}.csv`,
    }
}

// ─── Meta Lead/Booking export ─────────────────────────────────────────────────
//
// Same CSV format as order export, event_name = "Lead".
// For bookings clients, event_name = "Schedule" — more accurate for Meta's
// event taxonomy and improves optimization signal quality.
// Rows without email or fbc are skipped — no match signal.

export async function exportMetaLeads(
    clientId: string,
    startDate: string,
    endDate: string,
    failedOnly: boolean,
    eventName: string = 'Lead'
): Promise<ExportResult> {

    let query = supabase
        .from('leads')
        .select('external_lead_id, email, phone, lead_value, currency, created_at, sent_to_facebook, attribution_data')
        .eq('client_id', clientId)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: true })

    if (failedOnly) {
        query = query.eq('sent_to_facebook', false)
    }

    const { data, error } = await query

    if (error) throw new Error('Failed to fetch leads: ' + error.message)
    if (!data || data.length === 0) {
        return { csv: '', rowCount: 0, skippedCount: 0, filename: '' }
    }

    const headers = [
        'event_name',
        'event_time',
        'email',
        'phone',
        'fbc',
        'fbp',
        'value',
        'currency',
        'lead_id',
    ]

    const rows: string[][] = []
    let skippedCount = 0

    for (const lead of data) {
        const fbc: string = lead.attribution_data?.click_ids?.fbc ?? ''
        const fbp: string = lead.attribution_data?.click_ids?.fbp ?? ''
        const email: string = lead.email ?? ''
        const phone: string = lead.phone ?? ''

        if (!email && !fbc) {
            skippedCount++
            continue
        }

        const eventTime = Math.floor(new Date(lead.created_at).getTime() / 1000)

        rows.push([
            eventName,
            String(eventTime),
            email ? sha256(email) : '',
            phone ? sha256(normalizePhone(phone)) : '',
            fbc,
            fbp,
            String(lead.lead_value ?? ''),
            lead.currency ?? 'CZK',
            lead.external_lead_id,
        ])
    }

    const csv = [
        headers.join(','),
        ...rows.map(row => row.map(escapeCsvCell).join(','))
    ].join('\n')

    const dateTag = formatDateTag(startDate, endDate)
    const suffix = failedOnly ? '-failed-only' : ''
    const filePrefix = eventName === 'Schedule' ? 'meta-bookings' : 'meta-leads'

    return {
        csv,
        rowCount: rows.length,
        skippedCount,
        filename: `${filePrefix}-${dateTag}${suffix}.csv`,
    }
}

// ─── Google Lead/Booking export ───────────────────────────────────────────────
//
// Same format as order export — gclid + conversion name + time + value.
// Rows without gclid are skipped.

export async function exportGoogleLeads(
    clientId: string,
    startDate: string,
    endDate: string,
    failedOnly: boolean,
    conversionName: string = 'Lead'
): Promise<ExportResult> {

    let query = supabase
        .from('leads')
        .select('external_lead_id, lead_value, currency, created_at, sent_to_google, attribution_data')
        .eq('client_id', clientId)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: true })

    if (failedOnly) {
        query = query.eq('sent_to_google', false)
    }

    const { data, error } = await query

    if (error) throw new Error('Failed to fetch leads: ' + error.message)
    if (!data || data.length === 0) {
        return { csv: '', rowCount: 0, skippedCount: 0, filename: '' }
    }

    const headers = [
        'Google Click ID',
        'Conversion Name',
        'Conversion Time',
        'Conversion Value',
        'Conversion Currency',
        'Lead ID',
    ]

    const rows: string[][] = []
    let skippedCount = 0

    for (const lead of data) {
        const gclid: string = lead.attribution_data?.click_ids?.gclid ?? ''

        if (!gclid) {
            skippedCount++
            continue
        }

        rows.push([
            gclid,
            conversionName,
            formatGoogleTime(lead.created_at),
            String(lead.lead_value ?? ''),
            lead.currency ?? 'CZK',
            lead.external_lead_id,
        ])
    }

    const csv = [
        headers.join(','),
        ...rows.map(row => row.map(escapeCsvCell).join(','))
    ].join('\n')

    const dateTag = formatDateTag(startDate, endDate)
    const suffix = failedOnly ? '-failed-only' : ''
    const filePrefix = conversionName === 'Booking' ? 'google-bookings' : 'google-leads'

    return {
        csv,
        rowCount: rows.length,
        skippedCount,
        filename: `${filePrefix}-${dateTag}${suffix}.csv`,
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

// Wrap cells that contain commas, quotes, or newlines
function escapeCsvCell(value: string): string {
    if (/[,"\n\r]/.test(value)) {
        return '"' + value.replace(/"/g, '""') + '"'
    }
    return value
}

// Google Ads expects: "2026-04-17 10:00:00+00:00"
function formatGoogleTime(isoString: string): string {
    const d = new Date(isoString)
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
    )
}

// Filename date tag: "2026-04-01-to-2026-04-17"
function formatDateTag(startDate: string, endDate: string): string {
    const fmt = (d: string) => d.slice(0, 10)
    return `${fmt(startDate)}-to-${fmt(endDate)}`
}
