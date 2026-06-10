import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendToFacebook } from '@/lib/forwarding/facebook'
import { sendToGoogle } from '@/lib/forwarding/google'
import { enqueueFailedForwarding } from '@/lib/forwarding/queue'
import { verifyWebhook } from '@/lib/webhook-auth'
import { normalizeOrder, normalizePhone } from '@/lib/normalize'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

export async function POST(request: NextRequest) {
    // Correlation id: ties an error response, its log line and any queued
    // retry back to one specific webhook delivery
    const requestId = crypto.randomUUID().slice(0, 8)
    try {
        // Raw body needed for HMAC verification — parse after auth
        const rawBody = await request.text()
        if (!(await verifyWebhook(request, rawBody))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        // Reject order webhooks on leads-only deployments
        const { data: clientRow } = await supabase
            .from('clients')
            .select('settings')
            .eq('client_id', CLIENT_ID)
            .single()

        if (['leads', 'bookings'].includes(clientRow?.settings?.client_type)) {
            return NextResponse.json(
                { success: false, error: 'Order webhooks are disabled for this client type' },
                { status: 404 }
            )
        }

        const body = JSON.parse(rawBody)

        // Normalize order from different platforms
        const order = normalizeOrder(body)

        // === ATTRIBUTION MATCHING ===
        let session = null
        let matchType = 'none'

        // Priority 1: Session ID match (best)
        if (order.session_id) {
            const { data } = await supabase
                .from('sessions')
                .select('*')
                .eq('session_id', order.session_id)
                .eq('client_id', CLIENT_ID)
                .single()

            if (data) {
                session = data
                matchType = 'session'
            }
        }

        // Priority 2: Email match (cross-device)
        if (!session && order.email) {
            const { data } = await supabase
                .from('sessions')
                .select('*')
                .eq('email', order.email.toLowerCase().trim())
                .eq('client_id', CLIENT_ID)
                .order('updated_at', { ascending: false })
                .limit(1)
                .single()

            if (data) {
                session = data
                matchType = 'email'
            }
        }

        // Priority 3: Phone match
        if (!session && order.phone) {
            const normalizedPhone = normalizePhone(order.phone)
            const { data } = await supabase
                .from('sessions')
                .select('*')
                .eq('phone', normalizedPhone)
                .eq('client_id', CLIENT_ID)
                .order('updated_at', { ascending: false })
                .limit(1)
                .single()

            if (data) {
                session = data
                matchType = 'phone'
            }
        }

        // Priority 4: Customer ID match (returning customers)
        if (!session && order.customer_id) {
            const { data } = await supabase
                .from('sessions')
                .select('*')
                .eq('external_id', order.customer_id)
                .eq('client_id', CLIENT_ID)
                .order('updated_at', { ascending: false })
                .limit(1)
                .single()

            if (data) {
                session = data
                matchType = 'customer_id'
            }
        }

        // Calculate days to convert (use order's own date if provided, not server time)
        let daysToConvert = null
        if (session?.ft_timestamp) {
            const firstTouch = new Date(session.ft_timestamp)
            const orderDate = body.created_at ? new Date(body.created_at) : new Date()
            daysToConvert = Math.max(0, Math.floor((orderDate.getTime() - firstTouch.getTime()) / 86400000))
        }

        // Build attribution data
        const attributionData = session ? {
            session_id: session.session_id,
            first_touch: {
                source: session.ft_source,
                medium: session.ft_medium,
                campaign: session.ft_campaign,
                term: session.ft_term,
                content: session.ft_content,
                referrer: session.ft_referrer,
                landing: session.ft_landing,
                timestamp: session.ft_timestamp,
            },
            last_touch: {
                source: session.lt_source,
                medium: session.lt_medium,
                campaign: session.lt_campaign,
                term: session.lt_term,
                content: session.lt_content,
                referrer: session.lt_referrer,
                landing: session.lt_landing,
                timestamp: session.lt_timestamp,
            },
            click_ids: {
                gclid: session.gclid,
                fbclid: session.fbclid,
                fbc: session.fbc,
                fbp: session.fbp,
                ttclid: session.ttclid,
            },
            device: {
                type: session.device_type,
                browser: session.browser,
                os: session.os,
                country: session.country,
            },
            match_type: matchType,
        } : {
            match_type: 'none',
        }

        // Event ID for Meta CAPI <-> browser Pixel deduplication.
        // Must be deterministic from public data so the browser-side Pixel
        // tag can construct the same value. Order ID is unique per pixel.
        const eventId = `order_${order.external_id}`

        // === SAVE ORDER ===
        const { error: orderError } = await supabase.from('orders').upsert({
            client_id: CLIENT_ID,
            external_order_id: order.external_id,
            platform: order.platform,
            total_amount: order.total,
            subtotal: order.subtotal,
            tax: order.tax,
            shipping: order.shipping,
            currency: order.currency,
            customer_email: order.email,
            customer_phone: order.phone,
            customer_id: order.customer_id,
            items: order.items,
            session_id: session?.session_id || null,
            attribution_data: attributionData,
            match_type: matchType,
            days_to_convert: daysToConvert,
            facebook_event_id: eventId,
        }, { onConflict: 'client_id,external_order_id,platform' })

        if (orderError) throw orderError

        // === FORWARD TO AD PLATFORMS ===
        // Only if we have a session with consent
        let fbResult = null
        let googleResult = null

        if (session && session.consent_status !== 'denied') {
            // Get client settings
            const { data: clientData } = await supabase
                .from('clients')
                .select('settings')
                .eq('client_id', CLIENT_ID)
                .single()

            const settings = clientData?.settings || {}

            // Check if already sent (to prevent double events on retries)
            const { data: existingOrder } = await supabase
                .from('orders')
                .select('sent_to_facebook, sent_to_google')
                .eq('client_id', CLIENT_ID)
                .eq('external_order_id', order.external_id)
                .single()

            // Facebook CAPI
            if (settings.facebook?.pixel_id && settings.facebook?.access_token && !existingOrder?.sent_to_facebook) {
                fbResult = await sendToFacebook({
                    session,
                    order,
                    eventId,
                    pixelId: settings.facebook.pixel_id,
                    accessToken: settings.facebook.access_token,
                    testEventCode: settings.facebook.test_event_code,
                })

                if (fbResult?.success) {
                    await supabase.from('orders')
                        .update({ sent_to_facebook: true })
                        .eq('client_id', CLIENT_ID)
                        .eq('external_order_id', order.external_id)
                } else if (fbResult && !fbResult.success && fbResult.payload) {
                    await enqueueFailedForwarding({
                        clientId: CLIENT_ID,
                        eventType: 'order',
                        eventId: order.external_id,
                        platform: 'facebook',
                        payload: fbResult.payload,
                        error: `[${requestId}] ${String(fbResult.response?.error?.message || fbResult.error || 'unknown')}`,
                    })
                }
            }

            // Google Enhanced Conversions
            if (settings.google?.measurement_id && settings.google?.api_secret && !existingOrder?.sent_to_google) {
                googleResult = await sendToGoogle({
                    session,
                    order,
                    measurementId: settings.google.measurement_id,
                    apiSecret: settings.google.api_secret,
                })

                if (googleResult?.success) {
                    await supabase.from('orders')
                        .update({ sent_to_google: true })
                        .eq('client_id', CLIENT_ID)
                        .eq('external_order_id', order.external_id)
                } else if (googleResult && !googleResult.success && googleResult.payload) {
                    await enqueueFailedForwarding({
                        clientId: CLIENT_ID,
                        eventType: 'order',
                        eventId: order.external_id,
                        platform: 'google',
                        payload: googleResult.payload,
                        error: `[${requestId}] ${String(googleResult.error || 'unknown')}`,
                    })
                }
            }
        }

        return NextResponse.json({
            success: true,
            attributed: matchType !== 'none',
            match_type: matchType,
            forwarded: {
                facebook: fbResult?.success || false,
                google: googleResult?.success || false,
            },
        })

    } catch (error) {
        console.error(`[Order Webhook] [${requestId}] error:`, error)
        return NextResponse.json(
            { success: false, error: 'Internal error', request_id: requestId },
            { status: 500 }
        )
    }
}
