// lib/forwarding/facebook.ts

import type { FacebookParams, ForwardingResult } from '@/types'
import { sha256, normalizePhoneDigits, fbEventsUrl } from './shared'

export async function sendToFacebook(params: FacebookParams): Promise<ForwardingResult> {
    const { session, order, eventId, pixelId, accessToken, testEventCode } = params

    let payload: Record<string, any> | undefined

    try {
        // Hash user data (Facebook requires SHA256)
        const hashedEmail = order.email ? await sha256(order.email.toLowerCase().trim()) : null
        const hashedPhone = order.phone ? await sha256(normalizePhoneDigits(order.phone, session.country)) : null
        const hashedCountry = session.country ? await sha256(session.country.toLowerCase()) : null
        const hashedCity = session.city ? await sha256(session.city.toLowerCase().replace(/\s/g, '')) : null

        payload = {
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
                    // Meta requires the real IP — a hash is discarded as unparseable.
                    // Order-level IP (captured at checkout, e.g. by the Woo plugin)
                    // beats the session IP captured at first touch.
                    client_ip_address: order.ip_address || session.ip_address || undefined,
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
            fbEventsUrl(pixelId, accessToken),
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
            payload,
        }

    } catch (error) {
        console.error('Facebook CAPI error:', error)
        return { success: false, error, payload }
    }
}
