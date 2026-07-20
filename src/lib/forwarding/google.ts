// lib/forwarding/google.ts

import type { GoogleParams, ForwardingResult } from '@/types'
import { sha256, normalizePhoneE164 } from './shared'

export async function sendToGoogle(params: GoogleParams): Promise<ForwardingResult> {
    const { session, order, measurementId, apiSecret } = params

    // GA4 Measurement Protocol requires a real client_id tied to an actual
    // browser session (the _ga cookie GA4 itself set). Falling back to
    // HaloTrack's own internal session id used to send GA4 a "conversion" for
    // a client_id it has no history for — GA4 accepts that (204) but doesn't
    // reliably count it as a real Key Event. Skip instead of sending known-bad
    // data. No payload is set, so this isn't queued for retry either — a
    // missing ga_client_id isn't a transient failure that a retry would fix.
    if (!session.ga_client_id) {
        return { success: false }
    }

    let payload: Record<string, any> | undefined

    try {
        const hashedEmail = order.email ? await sha256(order.email.toLowerCase().trim()) : null
        // Google requires E.164 before hashing — bare digits never match
        const hashedPhone = order.phone ? await sha256(normalizePhoneE164(order.phone, session.country)) : null

        payload = {
            client_id: session.ga_client_id,
            events: [{
                name: 'purchase',
                params: {
                    transaction_id: order.external_id,
                    value: order.total,
                    currency: order.currency || 'CZK',
                    engagement_time_msec: 1,
                    // gclid anchors the event to the ad click — without it
                    // (and with weak session stitching) the event loses
                    // acquisition context and reports as "Unassigned"
                    ...(session.gclid ? { gclid: session.gclid } : {}),
                    // GA4's own session id (from the _ga_<container> cookie)
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
