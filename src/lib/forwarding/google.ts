// lib/forwarding/google.ts

import type { GoogleParams, ForwardingResult } from '@/types'

export async function sendToGoogle(params: GoogleParams): Promise<ForwardingResult> {
    const { session, order, measurementId, apiSecret } = params

    try {
        const hashedEmail = order.email ? await sha256(order.email.toLowerCase().trim()) : null
        const hashedPhone = order.phone ? await sha256(normalizePhone(order.phone)) : null

        const payload = {
            client_id: session.session_id,
            events: [{
                name: 'purchase',
                params: {
                    transaction_id: order.external_id,
                    value: order.total,
                    currency: order.currency || 'CZK',
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
        }

    } catch (error) {
        console.error('Google EC error:', error)
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
