import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendLeadToFacebook } from '@/lib/forwarding/facebook-lead'
import { sendLeadToGoogle } from '@/lib/forwarding/google-lead'
import { enqueueFailedForwarding } from '@/lib/forwarding/queue'
import { verifyWebhook } from '@/lib/webhook-auth'
import { normalizeLead, normalizePhone, type LeadWebhookBody } from '@/lib/normalize'

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

        // Reject lead webhooks on ecommerce-only deployments
        const { data: clientRow } = await supabase
            .from('clients')
            .select('settings')
            .eq('client_id', CLIENT_ID)
            .single()

        if (clientRow?.settings?.client_type === 'ecommerce') {
            return NextResponse.json(
                { success: false, error: 'Lead webhooks are disabled for ecommerce clients' },
                { status: 404 }
            )
        }

        const body = JSON.parse(rawBody) as LeadWebhookBody

        // Normalize lead from different sources
        const lead = normalizeLead(body)

        // === ATTRIBUTION MATCHING ===
        let session = null
        let matchType = 'none'

        // Priority 1: Session ID match (best - from cookie or hidden field)
        if (lead.session_id) {
            const { data } = await supabase
                .from('sessions')
                .select('*')
                .eq('session_id', lead.session_id)
                .eq('client_id', CLIENT_ID)
                .single()

            if (data) {
                session = data
                matchType = 'session'
            }
        }

        // Priority 2: Email match (cross-device)
        if (!session && lead.email) {
            const { data } = await supabase
                .from('sessions')
                .select('*')
                .eq('email', lead.email.toLowerCase().trim())
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
        if (!session && lead.phone) {
            const normalizedPhone = normalizePhone(lead.phone)
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

        // Visitor IP for Meta match quality: prefer the IP the client site
        // captured from the visitor's request; fall back to the matched
        // session's stored IP. Never use this webhook's own x-forwarded-for —
        // server-to-server it's the website server's IP, not the visitor's.
        if (!lead.ip_address) {
            lead.ip_address = session?.ip_address || null
        }

        // Calculate days to convert (use lead's own date if provided, not server time)
        let daysToConvert = null
        if (session?.ft_timestamp) {
            const firstTouch = new Date(session.ft_timestamp)
            const leadDate = body.created_at ? new Date(body.created_at) : new Date()
            daysToConvert = Math.max(0, Math.floor((leadDate.getTime() - firstTouch.getTime()) / 86400000))
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
                gbraid: session.gbraid,
                wbraid: session.wbraid,
                fbclid: session.fbclid,
                fbc: session.fbc,
                fbp: session.fbp,
                ttclid: session.ttclid,
            },
            url_params: session.custom_params || {},
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

        // Generate deterministic event ID for deduplication
        // We use the raw external_id (UUID from client) to match the Browser Pixel eventID
        const eventId = lead.external_id

        // === SAVE LEAD ===
        const { error: leadError } = await supabase.from('leads').upsert({
            client_id: CLIENT_ID,
            external_lead_id: lead.external_id,
            source: lead.source,
            email: lead.email,
            phone: lead.phone,
            name: lead.name,
            company: lead.company,
            form_type: lead.form_type,
            message: lead.message,
            lead_value: lead.value,
            currency: lead.currency,
            custom_fields: lead.custom_fields,
            session_id: session?.session_id || null,
            attribution_data: attributionData,
            match_type: matchType,
            days_to_convert: daysToConvert,
            facebook_event_id: eventId,
            consent_given: lead.consent_given || false,
            ip_address: lead.ip_address,
        }, { onConflict: 'client_id,external_lead_id,source' })

        if (leadError) throw leadError

        // === FORWARD TO AD PLATFORMS ===
        // Only if we have a session with consent
        let fbResult = null
        let googleResult = null

        console.log(`[Lead Webhook] Processing lead: ${lead.external_id}`);
        console.log(`[Lead Webhook] Session found: ${session ? session.session_id : 'NO'}`);
        if (session) console.log(`[Lead Webhook] Session Consent: ${session.consent_status}`);
        console.log(`[Lead Webhook] Lead Consent Given: ${lead.consent_given}`);

        if (session && session.consent_status !== 'denied' && lead.consent_given) {
            console.log('[Lead Webhook] Conditions met. Forwarding to Ad Platforms...');
            // Get client settings
            const { data: clientData } = await supabase
                .from('clients')
                .select('settings')
                .eq('client_id', CLIENT_ID)
                .single()

            const settings = clientData?.settings || {}

            // Check if already sent (to prevent double events on retries)
            const { data: existingLead } = await supabase
                .from('leads')
                .select('sent_to_facebook, sent_to_google')
                .eq('client_id', CLIENT_ID)
                .eq('external_lead_id', lead.external_id)
                .single()

            // Facebook Lead Ads
            if (settings.facebook?.pixel_id && settings.facebook?.access_token && !existingLead?.sent_to_facebook) {
                fbResult = await sendLeadToFacebook({
                    session,
                    lead,
                    eventId,
                    pixelId: settings.facebook.pixel_id,
                    accessToken: settings.facebook.access_token,
                    testEventCode: settings.facebook.test_event_code,
                })
                console.log(`[Lead Webhook] FB Result: ${JSON.stringify(fbResult)}`);

                if (fbResult?.success) {
                    await supabase.from('leads')
                        .update({ sent_to_facebook: true })
                        .eq('client_id', CLIENT_ID)
                        .eq('external_lead_id', lead.external_id)
                } else if (fbResult && !fbResult.success && fbResult.payload) {
                    await enqueueFailedForwarding({
                        clientId: CLIENT_ID,
                        eventType: 'lead',
                        eventId,
                        platform: 'facebook',
                        payload: fbResult.payload,
                        error: `[${requestId}] ${String(fbResult.response?.error?.message || fbResult.error || 'unknown')}`,
                    })
                }
            } else {
                console.log('[Lead Webhook] FB Skipped: Missing settings or already sent');
            }

            // Google server-side GA4 send — skipped when SKIP_SERVER_GA4_PURCHASE=true (Part 7 kill-switch; creds kept, reversible)
            if (settings.google?.measurement_id && settings.google?.api_secret && process.env.SKIP_SERVER_GA4_PURCHASE !== 'true' && !existingLead?.sent_to_google) {
                googleResult = await sendLeadToGoogle({
                    session,
                    lead,
                    measurementId: settings.google.measurement_id,
                    apiSecret: settings.google.api_secret,
                })
                console.log(`[Lead Webhook] Google Result: ${JSON.stringify(googleResult)}`);

                if (googleResult?.success) {
                    await supabase.from('leads')
                        .update({ sent_to_google: true })
                        .eq('client_id', CLIENT_ID)
                        .eq('external_lead_id', lead.external_id)
                } else if (googleResult && !googleResult.success && googleResult.payload) {
                    await enqueueFailedForwarding({
                        clientId: CLIENT_ID,
                        eventType: 'lead',
                        eventId,
                        platform: 'google',
                        payload: googleResult.payload,
                        error: `[${requestId}] ${String(googleResult.error || 'unknown')}`,
                    })
                }
            } else {
                console.log('[Lead Webhook] Google Skipped: Missing settings or already sent');
            }
        } else {
            console.log('[Lead Webhook] SKIPPED FORWARDING. Reason:');
            if (!session) console.log('- No Session found');
            if (session && session.consent_status === 'denied') console.log('- Session Consent is DENIED');
            if (!lead.consent_given) console.log('- Lead Consent NOT given');
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
        console.error(`[Lead Webhook] [${requestId}] error:`, error)
        return NextResponse.json(
            { success: false, error: 'Internal error', request_id: requestId },
            { status: 500 }
        )
    }
}
