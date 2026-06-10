// lib/forwarding/google.ts

import type { GoogleParams, ForwardingResult } from '@/types'
import { sha256, normalizePhoneE164 } from './shared'

export async function sendToGoogle(params: GoogleParams): Promise<ForwardingResult> {
    const { session, order, measurementId, apiSecret } = params

    let payload: Record<string, any> | undefined

    try {
        const hashedEmail = order.email ? await sha256(order.email.toLowerCase().trim()) : null
        // Google requires E.164 before hashing — bare digits never match
        const hashedPhone = order.phone ? await sha256(normalizePhoneE164(order.phone, session.country)) : null

        payload = {
            client_id: session.ga_client_id || session.session_id,
            events: [{
                name: 'purchase',
                params: {
                    transaction_id: order.external_id,
                    value: order.total,
                    currency: order.currency || 'CZK',
                    engagement_time_msec: 1,
                    // GA4's own session id (from the _ga_<container> cookie) —
                    // without it the event has no acquisition context and
                    // reports as "Unassigned"
                    ...(session.ga_session_id ? { session_id: session.ga_session_id } : {}),
                    items: order.items?.map((item: any) => ({
                        item_id: item.id,
                        item_name: item.name,
                        price: item.price,
                        quantity: item.quantity,
                    })) || [],
                },
            }],
            user_data: {
                sha256_email_address: hashedEmail || undefined,
                sha256_phone_number: hashedPhone || undefined,
            },
        }

        const response = await fetch(
            `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
            {
                method: 'POST',
                body: JSON.stringify(payload),
            }
        )

        return {
            success: response.ok,
            payload,
        }

    } catch (error) {
        console.error('Google EC error:', error)
        return { success: false, error, payload }
    }
}
