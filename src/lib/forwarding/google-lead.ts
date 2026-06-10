// lib/forwarding/google-lead.ts

import { sha256, normalizePhoneE164 } from './shared'

interface GoogleLeadParams {
    session: any
    lead: any
    measurementId: string
    apiSecret: string
}

export async function sendLeadToGoogle(params: GoogleLeadParams) {
    const { session, lead, measurementId, apiSecret } = params

    let payload: Record<string, any> | undefined

    try {
        const hashedEmail = lead.email ? await sha256(lead.email.toLowerCase().trim()) : null
        // Google requires E.164 before hashing — bare digits never match
        const hashedPhone = lead.phone ? await sha256(normalizePhoneE164(lead.phone, session.country)) : null

        payload = {
            client_id: session.ga_client_id || session.session_id,
            events: [{
                name: 'generate_lead_v2',
                params: {
                    value: lead.value || 0,
                    currency: lead.currency || 'CZK',
                    form_type: lead.form_type || 'contact',
                    transaction_id: lead.external_id,
                    engagement_time_msec: 1,
                    // GA4's own session id (from the _ga_<container> cookie) —
                    // without it the event has no acquisition context and
                    // reports as "Unassigned"
                    ...(session.ga_session_id ? { session_id: session.ga_session_id } : {}),
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
        console.error('Google Lead error:', error)
        return { success: false, error, payload }
    }
}
