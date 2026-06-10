// lib/forwarding/shared.ts
// Helpers shared by all ad-platform forwarding modules.

// Single place to bump the Meta Graph API version (v18.0 was past sunset — see
// docs/2026-06-10-halotrack-gap-analysis.md §A5).
export const FB_GRAPH_VERSION = 'v25.0'

export function fbEventsUrl(pixelId: string, accessToken: string): string {
    return `https://graph.facebook.com/${FB_GRAPH_VERSION}/${pixelId}/events?access_token=${accessToken}`
}

export async function sha256(str: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(str)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

// Calling codes for the markets we operate in. National numbers in these
// countries are 9 digits, which is what the length check below relies on.
const COUNTRY_CALLING_CODES: Record<string, string> = {
    CZ: '420',
    SK: '421',
}

/**
 * Digits-only phone with country code, no "+" — the format Meta expects
 * before hashing. A 9-digit national number gets the calling code of the
 * session's country prepended; numbers already in international form
 * ("+420…", "00420…", "420777123456") pass through unchanged.
 */
export function normalizePhoneDigits(phone: string, country?: string | null): string {
    const trimmed = phone.trim()
    const isInternational = trimmed.startsWith('+') || trimmed.startsWith('00')
    let digits = trimmed.replace(/\D/g, '')
    if (trimmed.startsWith('00')) digits = digits.slice(2)
    if (!isInternational && digits.length === 9) {
        const code = country ? COUNTRY_CALLING_CODES[country.toUpperCase()] : undefined
        if (code) digits = code + digits
    }
    return digits
}

/**
 * E.164 phone ("+420777123456") — Google requires this exact format before
 * SHA-256 hashing; a hash of the bare digits never matches.
 */
export function normalizePhoneE164(phone: string, country?: string | null): string {
    const digits = normalizePhoneDigits(phone, country)
    return digits ? `+${digits}` : ''
}
