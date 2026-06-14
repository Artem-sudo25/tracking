// src/lib/google-conversions.ts
// Pure builders for the Google Ads offline conversion CSV (import conversions
// from clicks + enhanced conversions). Kept free of DB/IO so they can be
// unit-tested and reused by both the manual dashboard export and the
// scheduled-pull endpoint.
//
// Format: https://support.google.com/google-ads/answer/7014069
// One click identifier per row — gclid preferred, then gbraid, then wbraid
// (iOS/app clicks often carry only gbraid).
//
// Enhanced conversions: each row may also carry a hashed Email + Phone Number.
// These let Google match orders whose purchasing session had NO click id (e.g.
// the customer clicked the ad on their phone but bought on a laptop). To match
// rows that have ONLY hashed data and no click id, the Google Ads conversion
// action must have "Enhanced conversions for leads" enabled — otherwise Google
// ignores the user-data columns and rejects those click-id-less rows (harmless;
// they're skipped, never double-counted).
//
// A row is emitted when it has ANY usable identifier (click id OR email OR
// phone). Rows with none are skipped — Google can't match them. Conversions
// whose session withdrew ad consent are skipped regardless (no identifiers, no
// PII, ever leave for a denied user).

import { createHash } from 'crypto'

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
    email?: string | null    // raw; hashed here
    phone?: string | null    // raw; hashed here
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
    'Email',
    'Phone Number',
]

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
        // Compliance: never upload click ids OR hashed PII for denied sessions.
        if (r.sessionId && deniedSessions.has(r.sessionId)) {
            skippedCount++
            continue
        }

        const picked = pickClickId(r.clickIds)
        const emailHash = r.email ? hashEmail(r.email) : ''
        const phoneHash = r.phone ? hashPhone(r.phone) : ''

        // Need at least one thing Google can match on.
        if (!picked && !emailHash && !phoneHash) {
            skippedCount++
            continue
        }

        rows.push([
            picked?.column === 'gclid' ? picked.value : '',
            picked?.column === 'gbraid' ? picked.value : '',
            picked?.column === 'wbraid' ? picked.value : '',
            conversionName,
            formatGoogleTime(r.createdAt),
            r.value != null ? String(r.value) : '',
            r.currency ?? 'CZK',
            r.externalId,
            emailHash,
            phoneHash,
        ])
    }

    const csv = [
        HEADERS.join(','),
        ...rows.map(row => row.map(escapeCsvCell).join(',')),
    ].join('\n')

    return { csv, rowCount: rows.length, skippedCount }
}

// ─── Enhanced-conversion hashing (Google: SHA-256 of normalized value) ────────
// Google accepts hex or base64; we use hex (same as the Meta export). Email is
// trimmed + lowercased; phone is E.164 (+countrycode) before hashing.

function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex')
}

export function hashEmail(email: string): string {
    const norm = email.trim().toLowerCase()
    return norm ? sha256Hex(norm) : ''
}

export function hashPhone(phone: string): string {
    const norm = normalizePhoneE164(phone)
    return norm.length > 1 ? sha256Hex(norm) : '' // '+' alone = no digits
}

// E.164: leading '+' and country code, digits only otherwise. Czech mobile
// numbers arrive as 9 bare digits — prepend 420. Mirrors the Meta export's
// normalizer but keeps the '+' Google's spec requires.
export function normalizePhoneE164(phone: string): string {
    let digits = phone.replace(/\D/g, '')
    if (digits.startsWith('00')) digits = digits.slice(2)
    else if (digits.length === 9) digits = '420' + digits
    return digits ? '+' + digits : ''
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
