// src/lib/session-consent.ts
// Shared batched lookup of sessions.consent_status by session id. Two very
// different consumers need this: the automatic export route (enforcement —
// gates which rows can leave HaloTrack for Google) and the dashboard UI
// (informational — shown next to the manual "Push to Google" control so a
// user can judge a lead before pushing it, per the unsafeSkipConsentGate
// design in src/lib/google-conversions.ts). Keeping the query itself in one
// place means a schema/RLS fix only needs to land once, and the dashboard's
// consent label can't silently drift out of sync with what the enforcement
// side actually sees.

export type ConsentStatus = 'granted' | 'unknown' | 'denied'

// Loosely typed on purpose: the two callers pass different Supabase client
// instances (service-role @supabase/supabase-js vs. the request-scoped
// @/lib/supabase/server client), and structurally typing the full
// from().select().eq().in() chain against both of their generic types hits
// TypeScript's instantiation-depth limit. Matches the rest of this codebase,
// which has no generated Database type for either client either.
interface ConsentQueryable {
    from(table: string): any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function fetchConsentBySession(
    supabase: ConsentQueryable,
    clientId: string,
    sessionIds: (string | null | undefined)[]
): Promise<Map<string, ConsentStatus>> {
    const ids = [...new Set(sessionIds.filter((id): id is string => Boolean(id)))]
    if (ids.length === 0) return new Map()

    const { data } = await supabase
        .from('sessions')
        .select('session_id, consent_status')
        .eq('client_id', clientId)
        .in('session_id', ids)

    return new Map(
        (data ?? []).map((r: { session_id: string; consent_status: ConsentStatus }) => [r.session_id, r.consent_status])
    )
}
