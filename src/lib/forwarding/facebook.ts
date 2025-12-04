// lib/forwarding/facebook.ts

import type { FacebookParams, ForwardingResult } from '@/types'

export async function sendToFacebook(params: FacebookParams): Promise<ForwardingResult> {
    const { session, order, eventId, pixelId, accessToken, testEventCode } = params

    try {
        // Hash user data (Facebook requires SHA256)
        const hashedEmail = order.email ? await sha256(order.email.toLowerCase().trim()) : null
        const hashedPhone = order.phone ? await sha256(normalizePhone(order.phone)) : null
        const hashedCountry = session.country ? await sha256(session.country.toLowerCase()) : null
        const hashedCity = session.city ? await sha256(session.city.toLowerCase().replace(/\s/g, '')) : null

        const payload = {
            data: [{
                event_name: 'Purchase',
                event_time: Math.floor(Date.now() / 1000),
                event_id: eventId,
                event_source_url: session.lt_landing || session.ft_landing,
                action_source: 'website',

                user_data: {
                    em: hashedEmail ? [hashedEmail] : undefined,
                    ph: hashedPhone ? [hashedPhone] : undefined,
                    fbc: session.fbc || undefined,
                    fbp: session.fbp || undefined,
                    client_ip_address: session.ip_hash || undefined,
                    client_user_agent: session.user_agent || undefined,
                    country: hashedCountry ? [hashedCountry] : undefined,
                    ct: hashedCity ? [hashedCity] : undefined,
                },

                custom_data: {
                    value: order.total,
                    currency: order.currency || 'CZK',
                    content_ids: order.items?.map((i: any) => i.id) || [],
                    content_type: 'product',
                    num_items: order.items?.length || 1,
                    contents: order.items?.map((i: any) => ({
                        id: i.id,
                        quantity: i.quantity,
                        item_price: i.price,
                    })),
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
        console.error('Facebook CAPI error:', error)
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
