import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendLeadToFacebook } from '@/lib/forwarding/facebook-lead'
import { sendLeadToGoogle } from '@/lib/forwarding/google-lead'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()

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

        // Calculate days to convert
        let daysToConvert = null
        if (session?.ft_timestamp) {
            const firstTouch = new Date(session.ft_timestamp)
            const leadDate = new Date()
            daysToConvert = Math.floor((leadDate.getTime() - firstTouch.getTime()) / 86400000)
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
        const eventId = `${CLIENT_ID}_lead_${lead.external_id}_${Date.now()}`

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

        if (session && session.consent_status !== 'denied' && lead.consent_given) {
            // Get client settings
            const { data: clientData } = await supabase
                .from('clients')
                .select('settings')
                .eq('client_id', CLIENT_ID)
                .single()

            const settings = clientData?.settings || {}

            // Facebook Lead Ads
            if (settings.facebook?.pixel_id && settings.facebook?.access_token) {
                fbResult = await sendLeadToFacebook({
                    session,
                    lead,
                    eventId,
                    pixelId: settings.facebook.pixel_id,
                    accessToken: settings.facebook.access_token,
                    testEventCode: settings.facebook.test_event_code,
                })

                if (fbResult?.success) {
                    await supabase.from('leads')
                        .update({ sent_to_facebook: true })
                        .eq('client_id', CLIENT_ID)
                        .eq('external_lead_id', lead.external_id)
                }
            }

            // Google Offline Conversions
            if (settings.google?.measurement_id && settings.google?.api_secret) {
                googleResult = await sendLeadToGoogle({
                    session,
                    lead,
                    measurementId: settings.google.measurement_id,
                    apiSecret: settings.google.api_secret,
                })

                if (googleResult?.success) {
                    await supabase.from('leads')
                        .update({ sent_to_google: true })
                        .eq('client_id', CLIENT_ID)
                        .eq('external_lead_id', lead.external_id)
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
        console.error('Lead webhook error:', error)
        return NextResponse.json(
            { success: false, error: 'Internal error' },
            { status: 500 }
        )
    }
}

// Normalize leads from different sources
function normalizeLead(body: any) {
    // Generic form format
    return {
        external_id: body.lead_id || body.id || `lead_${Date.now()}`,
        source: body.source || 'form',
        email: body.email?.toLowerCase().trim(),
        phone: body.phone ? normalizePhone(body.phone) : null,
        name: body.name || `${body.first_name || ''} ${body.last_name || ''}`.trim(),
        company: body.company || null,
        form_type: body.form_type || 'contact',
        message: body.message || body.comments || null,
        value: parseFloat(body.value || body.lead_value || 0),
        currency: body.currency || 'CZK',
        custom_fields: body.custom_fields || {},
        session_id: body.session_id || body.halo_session_id,
        consent_given: body.consent_given || body.gdpr_consent || false,
        ip_address: body.ip_address || null,
    }
}

function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '')
}
