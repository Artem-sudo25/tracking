import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendToFacebook } from '@/lib/forwarding/facebook'
import { sendToGoogle } from '@/lib/forwarding/google'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()

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

        // Calculate days to convert
        let daysToConvert = null
        if (session?.ft_timestamp) {
            const firstTouch = new Date(session.ft_timestamp)
            const orderDate = new Date()
            daysToConvert = Math.floor((orderDate.getTime() - firstTouch.getTime()) / 86400000)
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

        // Generate event ID for deduplication
        const eventId = `${CLIENT_ID}_${order.external_id}_${Date.now()}`

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

            // Facebook CAPI
            if (settings.facebook?.pixel_id && settings.facebook?.access_token) {
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
                }
            }

            // Google Enhanced Conversions
            if (settings.google?.measurement_id && settings.google?.api_secret) {
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
        console.error('Webhook error:', error)
        return NextResponse.json(
            { success: false, error: 'Internal error' },
            { status: 500 }
        )
    }
}

// Normalize orders from different platforms
function normalizeOrder(body: any) {
    // WooCommerce format
    if (body.billing || body.line_items) {
        return {
            external_id: String(body.id || body.order_id),
            platform: 'woocommerce',
            total: parseFloat(body.total || 0),
            subtotal: parseFloat(body.subtotal || 0),
            tax: parseFloat(body.total_tax || 0),
            shipping: parseFloat(body.shipping_total || 0),
            currency: body.currency || 'CZK',
            email: body.billing?.email?.toLowerCase(),
            phone: body.billing?.phone,
            customer_id: body.customer_id ? String(body.customer_id) : null,
            session_id: body.meta_data?.find((m: any) => m.key === '_halo_session')?.value ||
                body.halo_session_id,
            items: body.line_items?.map((item: any) => ({
                id: String(item.product_id),
                name: item.name,
                price: parseFloat(item.price),
                quantity: item.quantity,
            })),
        }
    }

    // Shopify format
    if (body.checkout_token || body.order_number) {
        const haloAttr = body.note_attributes?.find((a: any) =>
            a.name === 'halo_session_id' || a.name === '_halo_session'
        )

        return {
            external_id: String(body.id || body.order_number),
            platform: 'shopify',
            total: parseFloat(body.total_price || 0),
            subtotal: parseFloat(body.subtotal_price || 0),
            tax: parseFloat(body.total_tax || 0),
            shipping: parseFloat(body.total_shipping_price_set?.shop_money?.amount || 0),
            currency: body.currency || 'CZK',
            email: body.email?.toLowerCase() || body.customer?.email?.toLowerCase(),
            phone: body.phone || body.customer?.phone,
            customer_id: body.customer?.id ? String(body.customer.id) : null,
            session_id: haloAttr?.value,
            items: body.line_items?.map((item: any) => ({
                id: String(item.product_id),
                name: item.title,
                price: parseFloat(item.price),
                quantity: item.quantity,
            })),
        }
    }

    // Custom/generic format
    return {
        external_id: String(body.order_id || body.id),
        platform: body.platform || 'custom',
        total: parseFloat(body.total || body.total_amount || 0),
        subtotal: parseFloat(body.subtotal || 0),
        tax: parseFloat(body.tax || 0),
        shipping: parseFloat(body.shipping || 0),
        currency: body.currency || 'CZK',
        email: body.email?.toLowerCase() || body.customer_email?.toLowerCase(),
        phone: body.phone || body.customer_phone,
        customer_id: body.customer_id,
        session_id: body.session_id || body.halo_session_id,
        items: body.items,
    }
}

function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '')
}
