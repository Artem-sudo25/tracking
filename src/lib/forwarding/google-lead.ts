// lib/forwarding/google-lead.ts

interface GoogleLeadParams {
    session: any
    lead: any
    measurementId: string
    apiSecret: string
}

export async function sendLeadToGoogle(params: GoogleLeadParams) {
    const { session, lead, measurementId, apiSecret } = params

    try {
        const hashedEmail = lead.email ? await sha256(lead.email.toLowerCase().trim()) : null
        const hashedPhone = lead.phone ? await sha256(normalizePhone(lead.phone)) : null

        const payload = {
            client_id: session.session_id,
            events: [{
                name: 'generate_lead_v2',
                params: {
                    value: lead.value || 0,
                    currency: lead.currency || 'CZK',
                    form_type: lead.form_type || 'contact',
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
        }

    } catch (error) {
        console.error('Google Lead error:', error)
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
