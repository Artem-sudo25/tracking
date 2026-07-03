// src/lib/google-conversions.ts
// Pure builders for the Google Ads offline conversion CSV (import conversions
// from clicks). Kept free of DB/IO so they can be unit-tested and reused by both
// the manual dashboard export and the scheduled-pull endpoint.
//
// Format: https://support.google.com/google-ads/answer/7014069
// One click identifier per row — gclid preferred, then gbraid, then wbraid
// (iOS/app clicks often carry only gbraid). Rows with NO click id are skipped —
// the Google Ads "track conversions from clicks" action matches on click ids
// only (it has no email/phone match field), so click-id-less rows can't match
// and Google rejects them. Conversions whose session withdrew ad consent are
// skipped regardless.
//
// (We previously also emitted hashed email/phone for cross-device matching, but
// the click-based import action provides no field to map them to, so it was
// removed — see C6/C8 in the plan. Cross-device recovery would require a
// separate Enhanced Conversions for Leads action.)

export interface ClickIdSet {
    gclid?: string | null
    gbraid?: string | null
    wbraid?: string | null
}

export interface RawConversion {
    externalId: string
    value: number | null
    currency: string | null
    createdAt: string        // ISO timestamp
    sessionId: string | null
    clickIds: ClickIdSet
    // The session's HaloTrack consent_status. 'denied' rows are excluded
    // entirely; 'granted'/'unknown' map to the per-row consent columns below.
    consent?: 'granted' | 'unknown' | 'denied' | null
}

export interface GoogleCsvResult {
    csv: string
    rowCount: number
    skippedCount: number
}

const HEADERS = [
    'Google Click ID',
    'GBRAID',
    'WBRAID',
    'Conversion Name',
    'Conversion Time',
    'Conversion Value',
    'Conversion Currency',
    'Order ID',
    'Ad User Data Consent',
    'Ad Personalization Consent',
]

// Map HaloTrack's single consent_status to Google's per-row consent value.
// 'granted' → GRANTED; anything else we send (only 'unknown' survives the
// filter) → UNSPECIFIED, which is honest — we don't over-claim consent for the
// unknown cohort. Both Google consent fields get the same value.
function consentCell(consent: RawConversion['consent']): string {
    return consent === 'granted' ? 'GRANTED' : 'UNSPECIFIED'
}

// Prefer gclid; fall back to gbraid, then wbraid. Exactly one column is filled.
export function pickClickId(
    c: ClickIdSet
): { column: 'gclid' | 'gbraid' | 'wbraid'; value: string } | null {
    if (c.gclid) return { column: 'gclid', value: c.gclid }
    if (c.gbraid) return { column: 'gbraid', value: c.gbraid }
    if (c.wbraid) return { column: 'wbraid', value: c.wbraid }
    return null
}

// Build the Google Ads offline-conversion CSV. `deniedSessions` holds session
// ids whose consent_status is 'denied' (granted + unknown are uploadable — the
// agreed grey-area policy); their conversions are excluded entirely.
export function buildGoogleConversionsCsv(
    records: RawConversion[],
    conversionName: string,
    deniedSessions: ReadonlySet<string> = new Set()
): GoogleCsvResult {
    const rows: string[][] = []
    let skippedCount = 0

    for (const r of records) {
        // Compliance: never upload click ids for denied sessions. Denial can
        // arrive per-record (r.consent) or via the deniedSessions set.
        const denied =
            r.consent === 'denied' || (r.sessionId != null && deniedSessions.has(r.sessionId))
        if (denied) {
            skippedCount++
            continue
        }

        // This action matches on click ids only — skip rows without one.
        const picked = pickClickId(r.clickIds)
        if (!picked) {
            skippedCount++
            continue
        }

        const consent = consentCell(r.consent)

        rows.push([
            picked.column === 'gclid' ? picked.value : '',
            picked.column === 'gbraid' ? picked.value : '',
            picked.column === 'wbraid' ? picked.value : '',
            conversionName,
            formatGoogleTime(r.createdAt),
            r.value != null ? String(r.value) : '',
            r.currency ?? 'CZK',
            r.externalId,
            consent,
            consent,
        ])
    }

    const csv = [
        HEADERS.join(','),
        ...rows.map(row => row.map(escapeCsvCell).join(',')),
    ].join('\n')

    return { csv, rowCount: rows.length, skippedCount }
}

// Wrap cells containing commas, quotes, or newlines (RFC 4180).
export function escapeCsvCell(value: string): string {
    if (/[,"\n\r]/.test(value)) {
        return '"' + value.replace(/"/g, '""') + '"'
    }
    return value
}

// Google Ads expects e.g. "2026-06-13 10:00:00+00:00".
export function formatGoogleTime(isoString: string): string {
    const d = new Date(isoString)
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
    )
}
