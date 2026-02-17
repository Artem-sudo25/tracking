import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPageViewToFacebook } from '@/lib/forwarding/facebook-pageview'
import { sendPageViewToGoogle } from '@/lib/forwarding/google-pageview'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()

        // Check for existing session
        let sessionId = request.cookies.get('_halo')?.value

        // If not in cookie, check body (for cross-domain or initial load)
        if (!sessionId && body.session_id) {
            sessionId = body.session_id
        }

        const consentStatus = body.consent || 'unknown'

        // === CONSENT DENIED ===
        if (consentStatus === 'denied') {
            if (body.utm_source || body.referrer) {
                await supabase.from('anon_events').insert({
                    client_id: CLIENT_ID,
                    utm_source: body.utm_source,
                    utm_medium: body.utm_medium,
                    utm_campaign: body.utm_campaign,
                    utm_term: body.utm_term,
                    utm_content: body.utm_content,
                    referrer_domain: body.referrer ? new URL(body.referrer).hostname : null,
                    page_path: body.landing,
                    event_type: 'page_view',
                })
            }
            return NextResponse.json({ session_id: null })
        }

        // === FULL TRACKING ===

        // Helper to hash IP
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
        const ipHash = await hashString(ip)

        const userAgent = request.headers.get('user-agent') || ''
        const device = parseUserAgent(userAgent)

        // Auto-detect source/medium from click IDs when UTMs are absent
        let inferredSource = body.utm_source || null
        let inferredMedium = body.utm_medium || null
        if (!inferredSource) {
            if (body.gclid || body.gbraid || body.wbraid) {
                inferredSource = 'google'
                inferredMedium = inferredMedium || 'cpc'
            } else if (body.fbclid) {
                inferredSource = 'facebook'
                inferredMedium = inferredMedium || 'cpc'
            } else if (body.ttclid) {
                inferredSource = 'tiktok'
                inferredMedium = inferredMedium || 'cpc'
            } else if (body.msclkid) {
                inferredSource = 'bing'
                inferredMedium = inferredMedium || 'cpc'
            }
        }

        const referrerHostname = (() => {
            try { return body.referrer ? new URL(body.referrer).hostname : null }
            catch { return null }
        })()

        const touch = {
            source: inferredSource,
            medium: inferredMedium,
            campaign: body.utm_campaign,
            term: body.utm_term,
            content: body.utm_content,
            referrer: referrerHostname,
            referrer_full: body.referrer || null,
            landing: body.landing,
            timestamp: new Date().toISOString(),
        }

        // Only count as a meaningful touch if there's actual marketing data (not just a referrer)
        // This prevents a direct/untagged page navigation from overwriting a paid campaign attribution
        const hasTouchData = touch.source || body.gclid || body.fbclid || body.ttclid || body.msclkid

        if (!sessionId) {
            // Create new session
            sessionId = crypto.randomUUID()

            await supabase.from('sessions').insert({
                client_id: CLIENT_ID,
                session_id: sessionId,
                consent_status: consentStatus,

                ft_source: touch.source,
                ft_medium: touch.medium,
                ft_campaign: touch.campaign,
                ft_term: touch.term,
                ft_content: touch.content,
                ft_referrer: touch.referrer,
                ft_referrer_full: touch.referrer_full,
                ft_landing: touch.landing,
                ft_timestamp: touch.timestamp,

                lt_source: touch.source,
                lt_medium: touch.medium,
                lt_campaign: touch.campaign,
                lt_term: touch.term,
                lt_content: touch.content,
                lt_referrer: touch.referrer,
                lt_landing: touch.landing,
                lt_timestamp: touch.timestamp,

                gclid: body.gclid,
                fbclid: body.fbclid,
                ttclid: body.ttclid,
                msclkid: body.msclkid,

                user_agent: userAgent,
                device_type: device.type,
                browser: device.browser,
                browser_version: device.browserVersion,
                os: device.os,
                os_version: device.osVersion,

                ip_hash: ipHash,
                // Geo headers might not be available here if called from client-side fetch, 
                // unless passed through or inferred from IP by Supabase/Edge function.
                // For now we skip geo if not available.

                language: request.headers.get('accept-language')?.split(',')[0] || 'unknown',
            })
        } else if (hasTouchData) {
            // Update existing session
            const updateData: any = {
                lt_source: touch.source,
                lt_medium: touch.medium,
                lt_campaign: touch.campaign,
                lt_term: touch.term,
                lt_content: touch.content,
                lt_referrer: touch.referrer,
                lt_landing: touch.landing,
                lt_timestamp: touch.timestamp,
                updated_at: new Date().toISOString(),
            }

            if (body.gclid) updateData.gclid = body.gclid
            if (body.fbclid) updateData.fbclid = body.fbclid
            if (body.ttclid) updateData.ttclid = body.ttclid
            if (body.msclkid) updateData.msclkid = body.msclkid

            await supabase.from('sessions')
                .update(updateData)
                .eq('session_id', sessionId)
                .eq('client_id', CLIENT_ID)
        }

        // === RECORD TOUCHPOINT (JOURNEY) ===
        // If this is a new session OR has new marketing data, we record a touchpoint.
        // We want to capture the full journey: 1st touch, 2nd touch, etc.
        if (hasTouchData) {
            // Get current touchpoint count for this visitor
            const { count } = await supabase
                .from('touchpoints')
                .select('*', { count: 'exact', head: true })
                .eq('client_id', CLIENT_ID)
                .eq('session_id', sessionId)

            const nextNumber = (count || 0) + 1

            // Insert new touchpoint
            await supabase.from('touchpoints').insert({
                client_id: CLIENT_ID,
                session_id: sessionId,
                source: touch.source,
                medium: touch.medium,
                campaign: touch.campaign,
                term: touch.term,
                content: touch.content,
                referrer: touch.referrer,
                landing_page: touch.landing,
                page_path: body.landing, // initial landing of this touch
                gclid: body.gclid,
                fbclid: body.fbclid,
                ttclid: body.ttclid,
                msclkid: body.msclkid,
                touchpoint_number: nextNumber,
                timestamp: touch.timestamp
            })
        }

        // === FORWARD TO FACEBOOK (SERVER-SIDE PAGEVIEW) ===
        if (consentStatus === 'granted') {
            const fbc = request.cookies.get('_fbc')?.value
            const fbp = request.cookies.get('_fbp')?.value
            const country = request.headers.get('x-vercel-ip-country')
            const city = request.headers.get('x-vercel-ip-city')

            const { data: clientData } = await supabase
                .from('clients')
                .select('settings')
                .eq('client_id', CLIENT_ID)
                .single()

            const settings = clientData?.settings || {}

            if (settings.facebook?.pixel_id && settings.facebook?.access_token) {
                // Construct session object for forwarding
                const sessionForFb = {
                    fbc: fbc || undefined,
                    fbp: fbp || undefined,
                    ip_hash: ipHash,
                    user_agent: userAgent,
                    country: country,
                    city: city,
                    ft_landing: touch.landing,
                    lt_landing: touch.landing
                }

                await sendPageViewToFacebook({
                    session: sessionForFb,
                    url: body.referrer || body.landing,
                    eventId: `${CLIENT_ID}_pv_${sessionId}_${Date.now()}`,
                    pixelId: settings.facebook.pixel_id,
                    accessToken: settings.facebook.access_token,
                    testEventCode: settings.facebook.test_event_code
                })
            }

            // Google Analytics 4 (Server-Side)
            if (settings.google?.measurement_id && settings.google?.api_secret) {
                // Fire and forget
                await sendPageViewToGoogle({
                    session: { session_id: sessionId, user_id: request.cookies.get('user_id')?.value },
                    url: body.referrer || body.landing,
                    measurementId: settings.google.measurement_id,
                    apiSecret: settings.google.api_secret
                })
            }
        }

        // Return session_id so client can store it
        const response = NextResponse.json({ session_id: sessionId })

        // Set cookie if on same domain
        response.cookies.set('_halo', sessionId, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 31536000,
            path: '/',
            sameSite: 'lax',
        })

        return response

    } catch (error) {
        console.error('Touch error:', error)
        return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
    }
}

// ... (helper functions area)

async function hashString(str: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(str)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .substring(0, 32)
}

function parseUserAgent(ua: string) {
    // ... (rest of parser)
    let type = 'desktop'
    if (/mobile/i.test(ua)) type = 'mobile'
    else if (/tablet|ipad/i.test(ua)) type = 'tablet'

    let browser = 'Unknown'
    let browserVersion = ''
    if (/edg/i.test(ua)) {
        browser = 'Edge'
        browserVersion = ua.match(/edg\/(\d+)/i)?.[1] || ''
    } else if (/chrome/i.test(ua) && !/edg/i.test(ua)) {
        browser = 'Chrome'
        browserVersion = ua.match(/chrome\/(\d+)/i)?.[1] || ''
    } else if (/safari/i.test(ua) && !/chrome/i.test(ua)) {
        browser = 'Safari'
        browserVersion = ua.match(/version\/(\d+)/i)?.[1] || ''
    } else if (/firefox/i.test(ua)) {
        browser = 'Firefox'
        browserVersion = ua.match(/firefox\/(\d+)/i)?.[1] || ''
    }

    let os = 'Unknown'
    let osVersion = ''
    if (/windows/i.test(ua)) {
        os = 'Windows'
        osVersion = ua.match(/windows nt (\d+\.\d+)/i)?.[1] || ''
    } else if (/mac os/i.test(ua)) {
        os = 'macOS'
        osVersion = ua.match(/mac os x (\d+[._]\d+)/i)?.[1]?.replace('_', '.') || ''
    } else if (/iphone|ipad/i.test(ua)) {
        os = 'iOS'
        osVersion = ua.match(/os (\d+[._]\d+)/i)?.[1]?.replace('_', '.') || ''
    } else if (/android/i.test(ua)) {
        os = 'Android'
        osVersion = ua.match(/android (\d+\.?\d*)/i)?.[1] || ''
    }

    return { type, browser, browserVersion, os, osVersion }
}
