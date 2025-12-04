// lib/forwarding/facebook-lead.ts

interface FacebookLeadParams {
    session: any
    lead: any
    eventId: string
    pixelId: string
    accessToken: string
    testEventCode?: string
}

export async function sendLeadToFacebook(params: FacebookLeadParams) {
    const { session, lead, eventId, pixelId, accessToken, testEventCode } = params

    try {
        // Hash user data (Facebook requires SHA256)
        const hashedEmail = lead.email ? await sha256(lead.email.toLowerCase().trim()) : null
        const hashedPhone = lead.phone ? await sha256(normalizePhone(lead.phone)) : null
        const hashedName = lead.name ? await sha256(lead.name.toLowerCase().trim()) : null
        const hashedCountry = session.country ? await sha256(session.country.toLowerCase()) : null
        const hashedCity = session.city ? await sha256(session.city.toLowerCase().replace(/\s/g, '')) : null

        const payload = {
            data: [{
                event_name: 'Lead',
                event_time: Math.floor(Date.now() / 1000),
                event_id: eventId,
                event_source_url: session.lt_landing || session.ft_landing,
                action_source: 'website',

                user_data: {
                    em: hashedEmail ? [hashedEmail] : undefined,
                    ph: hashedPhone ? [hashedPhone] : undefined,
                    fn: hashedName ? [hashedName.split(' ')[0]] : undefined,
                    ln: hashedName ? [hashedName.split(' ').slice(1).join(' ')] : undefined,
                    fbc: session.fbc || undefined,
                    fbp: session.fbp || undefined,
                    client_ip_address: session.ip_hash || undefined,
                    client_user_agent: session.user_agent || undefined,
                    country: hashedCountry ? [hashedCountry] : undefined,
                    ct: hashedCity ? [hashedCity] : undefined,
                },

                custom_data: {
                    value: lead.value || 0,
                    currency: lead.currency || 'CZK',
                    content_name: lead.form_type || 'contact_form',
                    content_category: 'lead_generation',
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
        console.error('Facebook Lead CAPI error:', error)
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

function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '')
}
