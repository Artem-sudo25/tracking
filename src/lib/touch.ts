// src/lib/touch.ts
// Touchpoint dedupe — pure function, extracted from the touch route so it can
// be unit-tested (App Router route files can only export route handlers).

export interface TouchpointFingerprint {
    source?: string | null
    medium?: string | null
    campaign?: string | null
    gclid?: string | null
    fbclid?: string | null
    ttclid?: string | null
    msclkid?: string | null
    timestamp?: string | null
}

// UTM-only touches with no click ID can legitimately repeat (e.g. the same
// newsletter link clicked again next week), so identical ones only count as
// a refresh/back-navigation within this window.
const UTM_REFRESH_WINDOW_MS = 30 * 60 * 1000

// Google Consent Mode's URL passthrough re-appends the same gclid to every
// internal link when ad cookies are declined, which would otherwise record
// one "marketing touchpoint" per pageview for the whole browsing session.
// Same click ID + same source/medium/campaign = still the same ad click.
export function isDuplicateTouchpoint(
    prev: TouchpointFingerprint | null | undefined,
    next: TouchpointFingerprint,
    now: number = Date.now()
): boolean {
    if (!prev) return false

    const same = (a?: string | null, b?: string | null) => (a ?? null) === (b ?? null)

    const sameClickIds =
        same(prev.gclid, next.gclid) &&
        same(prev.fbclid, next.fbclid) &&
        same(prev.ttclid, next.ttclid) &&
        same(prev.msclkid, next.msclkid)

    const sameUtm =
        same(prev.source, next.source) &&
        same(prev.medium, next.medium) &&
        same(prev.campaign, next.campaign)

    if (!sameClickIds || !sameUtm) return false

    const hasClickId = Boolean(next.gclid || next.fbclid || next.ttclid || next.msclkid)
    if (hasClickId) return true

    const prevTime = prev.timestamp ? new Date(prev.timestamp).getTime() : NaN
    return Number.isFinite(prevTime) && now - prevTime < UTM_REFRESH_WINDOW_MS
}
