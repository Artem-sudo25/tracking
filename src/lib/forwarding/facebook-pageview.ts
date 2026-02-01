
interface FacebookPageViewParams {
    session: any
    url: string
    eventId: string
    pixelId: string
    accessToken: string
    testEventCode?: string
}

export async function sendPageViewToFacebook(params: FacebookPageViewParams) {
    const { session, url, eventId, pixelId, accessToken, testEventCode } = params

    try {
        // Hash user data (Facebook requires SHA256)
        // Note: For PageView, we might not have all PII, but we send what we have from session
        const hashedCountry = session.country ? await sha256(session.country.toLowerCase()) : null
        const hashedCity = session.city ? await sha256(session.city.toLowerCase().replace(/\s/g, '')) : null

        const payload = {
            data: [{
                event_name: 'PageView',
                event_time: Math.floor(Date.now() / 1000),
                event_id: eventId,
                event_source_url: url,
                action_source: 'website',

                user_data: {
                    fbc: session.fbc || undefined,
                    fbp: session.fbp || undefined,
                    client_ip_address: session.ip_hash || undefined, // Note: Facebook prefers real IP, but we hash for privacy. CAPI might accept hashed or require override.
                    // For best CAPI matching, we rely heavily on fbp/fbc
                    client_user_agent: session.user_agent || undefined,
                    country: hashedCountry ? [hashedCountry] : undefined,
                    ct: hashedCity ? [hashedCity] : undefined,
                },
            }],
            ...(testEventCode && { test_event_code: testEventCode }),
        }

        const response = await fetch(
            `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${accessToken}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        )

        const result = await response.json()

        return {
            success: response.ok && !result.error,
            response: result,
        }

    } catch (error) {
        console.error('Facebook PageView CAPI error:', error)
        return { success: false, error }
    }
}

async function sha256(str: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(str)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}
