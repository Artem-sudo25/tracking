// src/lib/google-export-auth.ts
// Shared auth + window-clamping helpers for the Google Ads CSV export routes
// (src/app/api/export/google-conversions and .../google-conversions-manual).
// Both endpoints guard the same GOOGLE_EXPORT_KEY secret and accept the same
// two ways of providing it — kept in one place so a future auth fix only
// needs to land once. Mirrors the precedent of src/lib/webhook-auth.ts.

import { NextRequest } from 'next/server'

export function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

// The provided secret can arrive two ways: ?key=… (browser test) or HTTP Basic
// Auth (what Google Ads' scheduled HTTPS upload sends). For Basic Auth we check
// the password component against GOOGLE_EXPORT_KEY; the username is ignored.
export function extractProvidedKey(request: NextRequest): string {
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

export function isAuthorized(request: NextRequest, expectedKey: string | undefined): boolean {
    const provided = extractProvidedKey(request)
    return Boolean(expectedKey) && Boolean(provided) && timingSafeEqual(provided, expectedKey!)
}

const MAX_WINDOW_DAYS = 90

// Resolve the rolling-window `?days=` param into a clamped day count and the
// resulting `since` ISO timestamp. Shared so a future change to the cap only
// needs to land in one place.
export function resolveWindow(request: NextRequest, defaultDays: number): { days: number; since: string } {
    const daysParam = parseInt(request.nextUrl.searchParams.get('days') ?? '', 10)
    const days = Number.isFinite(daysParam)
        ? Math.min(Math.max(daysParam, 1), MAX_WINDOW_DAYS)
        : defaultDays
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    return { days, since }
}
