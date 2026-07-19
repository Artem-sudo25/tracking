'use server'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { differenceInDays, differenceInHours, format } from 'date-fns'
import type { DashboardData } from '@/types'
import type {
    LeadAttributionData,
    LeadListItem,
    LeadListPage,
    LeadListScope,
    LeadsDashboardData,
    PipelineMetricsData,
} from '@/types/dashboard'
import { fetchConsentBySession } from '@/lib/session-consent'

const DEFAULT_LEADS_PAGE_SIZE = 20
const leadListSelect = 'id, name, email, phone, form_type, lead_value, status, created_at, message, custom_fields, attribution_data, session_id, sent_to_google, manual_google_push_at, manual_google_push_value'

// Consent lives on sessions.consent_status, not on the lead — shares the
// batched lookup (src/lib/session-consent.ts) with the automatic export
// route's enforcement-side check, so both stay in sync. Informational only
// here (surfaced in the dashboard UI so a user can judge a lead before
// manually pushing it — see pushLeadToGoogleAds); it never gates anything
// client-side.
export async function attachConsentStatus<
    T extends { session_id?: string | null; attribution_data?: LeadAttributionData | null }
>(leads: T[], clientId: string): Promise<(T & { consent_status: 'granted' | 'unknown' | 'denied' | null })[]> {
    const supabase = await createClient()
    const consentBySession = await fetchConsentBySession(
        supabase,
        clientId,
        leads.map(l => l.session_id ?? l.attribution_data?.session_id ?? null)
    )

    return leads.map(l => {
        const sessionId = l.session_id ?? l.attribution_data?.session_id ?? null
        return {
            ...l,
            consent_status: sessionId ? consentBySession.get(sessionId) ?? null : null,
        }
    })
}

interface TouchpointRow {
    session_id: string
    source: string | null
    medium: string | null
}

interface PipelineLeadRow {
    status: string | null
    source: string | null
    deal_value: number | null
    attribution_data: LeadAttributionData | null
    session_id: string | null
}

// Helper function to determine time label
function getTimeLabel(startDate: string, endDate: string): string {
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    const daysDiff = differenceInDays(endDateObj, startDateObj);
    const hoursDiff = differenceInHours(endDateObj, startDateObj);

    if (hoursDiff < 24) return 'Today';
    if (daysDiff === 1) return 'Yesterday';
    if (daysDiff <= 7) return 'This Week';
    if (daysDiff <= 30) return 'This Month';
    if (daysDiff <= 90) return 'This Quarter';
    return 'in Period';
}

export async function getDashboardData(
    clientId: string,
    startDate?: string,
    endDate?: string
): Promise<DashboardData> {
    const supabase = await createClient()

    // Use provided dates or default to last 30 days
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const end = endDate || new Date().toISOString()

    // 1. Total Revenue & Orders
    const { data: orders } = await supabase
        .from('orders')
        .select('*')
        .eq('client_id', clientId)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false })

    const totalRevenue = orders?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0
    const totalOrders = orders?.length || 0

    // 2. Attribution Rate
    const attributedOrders = orders?.filter(o => o.match_type && o.match_type !== 'none').length || 0
    const attributionRate = totalOrders > 0 ? attributedOrders / totalOrders : 0

    // 3. Avg Days to Convert
    const ordersWithDays = orders?.filter(o => o.days_to_convert !== null) || []
    const avgDaysToConvert = ordersWithDays.length > 0
        ? ordersWithDays.reduce((sum, o) => sum + (o.days_to_convert || 0), 0) / ordersWithDays.length
        : 0

    // 4. Revenue by Source (First Touch)
    const sourceMap = new Map()
    orders?.forEach(o => {
        if (o.attribution_data?.first_touch) {
            const source = o.attribution_data.first_touch.source || 'Direct'
            const medium = o.attribution_data.first_touch.medium || '(none)'
            const key = `${source}/${medium}`

            if (!sourceMap.has(key)) {
                sourceMap.set(key, { source, medium, orders: 0, revenue: 0 })
            }

            const entry = sourceMap.get(key)
            entry.orders += 1
            entry.revenue += (o.total_amount || 0)
        }
    })

    const revenueBySource = Array.from(sourceMap.values())
        .sort((a, b) => b.revenue - a.revenue)

    // Get ad spend for this period
    const { data: adSpend } = await supabase
        .from('ad_spend')
        .select('source, medium, spend')
        .eq('client_id', clientId)
        .gte('date', start)
        .lte('date', end)

    // Aggregate spend by source/medium (case-insensitive)
    const spendMap = new Map()
    adSpend?.forEach(s => {
        // Normalize to lowercase for matching
        const key = `${s.source.toLowerCase()}/${s.medium.toLowerCase()}`
        spendMap.set(key, (spendMap.get(key) || 0) + s.spend)
    })

    // Add spend and ROI to revenueBySource
    const revenueWithROI = revenueBySource.map(source => {
        // Normalize source/medium for matching
        const key = `${source.source.toLowerCase()}/${source.medium.toLowerCase()}`
        const spend = spendMap.get(key) || 0

        // E-commerce metrics (for purchases)
        const cpa = source.orders > 0 ? spend / source.orders : 0
        const roas = spend > 0 ? source.revenue / spend : 0
        const profit = source.revenue - spend

        return {
            ...source,
            spend,
            cpa,
            roas,
            profit
        }
    })

    // 5. Revenue Chart (Daily)
    const dailyMap = new Map()
    orders?.forEach(o => {
        const date = format(new Date(o.created_at), 'MMM dd')
        if (!dailyMap.has(date)) {
            dailyMap.set(date, 0)
        }
        dailyMap.set(date, dailyMap.get(date) + (o.total_amount || 0))
    })

    // Fill in missing days (simplified)
    const chartData = Array.from(dailyMap.entries())
        .map(([date, revenue]) => ({ date, revenue }))
        .reverse() // Supabase returns desc, we want asc for chart? No, we iterated.
    // Actually we should sort by date properly.

    return {
        stats: {
            totalRevenue,
            totalOrders,
            attributionRate,
            avgDaysToConvert
        },
        revenueBySource: revenueWithROI,
        recentOrders: orders || [],
        chartData
    }
}

export async function getLeadsDashboardData(
    clientId: string,
    startDate?: string,
    endDate?: string
): Promise<LeadsDashboardData> {
    const supabase = await createClient()

    // Use provided dates or default to last 30 days
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const end = endDate || new Date().toISOString()

    const timeLabel = getTimeLabel(start, end)

    // 1. Fetch all leads
    const { data: leads } = await supabase
        .from('leads')
        .select('id, created_at, form_type, lead_value, status, attribution_data')
        .eq('client_id', clientId)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false })

    const totalLeads = leads?.length || 0

    // 2. Cost per lead (CPL)
    // Get ad spend for the period
    const { data: adSpendData } = await supabase
        .from('ad_spend')
        .select('spend')
        .eq('client_id', clientId)
        .gte('date', start)
        .lte('date', end)

    const totalSpend = adSpendData?.reduce((sum, s) => sum + (s.spend || 0), 0) || 0
    const costPerLead = totalLeads > 0 ? totalSpend / totalLeads : 0

    // 3. Leads by form type
    const formTypeMap = new Map()
    leads?.forEach(l => {
        const formType = l.form_type || 'unknown'
        if (!formTypeMap.has(formType)) {
            formTypeMap.set(formType, { formType, count: 0, value: 0 })
        }
        const entry = formTypeMap.get(formType)
        entry.count += 1
        entry.value += (l.lead_value || 0)
    })

    const leadsByFormType = Array.from(formTypeMap.values())
        .sort((a, b) => b.count - a.count)

    // 4. Leads by source (first touch) - include ALL leads
    const sourceMap = new Map()
    leads?.forEach(l => {
        // Handle leads with and without attribution data
        let source = 'Direct'
        let medium = '(none)'

        if (l.attribution_data?.first_touch) {
            source = l.attribution_data.first_touch.source || 'Direct'
            medium = l.attribution_data.first_touch.medium || '(none)'
        }

        const key = `${source}/${medium}`

        if (!sourceMap.has(key)) {
            sourceMap.set(key, { source, medium, count: 0, value: 0 })
        }

        const entry = sourceMap.get(key)
        entry.count += 1
        entry.value += (l.lead_value || 0)
    })

    const leadsBySource = Array.from(sourceMap.values())
        .sort((a, b) => b.count - a.count)

    // 5. Get ad spend for this period and calculate lead-gen ROI
    const { data: adSpend } = await supabase
        .from('ad_spend')
        .select('source, medium, spend')
        .eq('client_id', clientId)
        .gte('date', start)
        .lte('date', end)

    // Aggregate spend by source/medium (case-insensitive)
    const spendMap = new Map()
    adSpend?.forEach(s => {
        // Normalize to lowercase for matching
        const key = `${s.source.toLowerCase()}/${s.medium.toLowerCase()}`
        spendMap.set(key, (spendMap.get(key) || 0) + s.spend)
    })

    // Add spend and lead-gen ROI to leadsBySource
    const leadsWithROI = leadsBySource.map(source => {
        // Normalize source/medium for matching
        const key = `${source.source.toLowerCase()}/${source.medium.toLowerCase()}`
        const spend = spendMap.get(key) || 0

        // Lead-gen metrics
        const cpl = source.count > 0 ? spend / source.count : 0  // Cost Per Lead

        // TODO: Add lead-to-customer conversion rate when we track conversions
        // const customers = source.customers || 0
        // const conversionRate = source.count > 0 ? customers / source.count : 0
        // const cpc = customers > 0 ? spend / customers : 0  // Cost Per Customer

        return {
            ...source,
            spend,
            cpl,  // This is the key metric for lead-gen!
        }
    })

    // 6. Leads over time (daily)
    const dailyMap = new Map()
    leads?.forEach(l => {
        const date = format(new Date(l.created_at), 'MMM dd')
        if (!dailyMap.has(date)) {
            dailyMap.set(date, 0)
        }
        dailyMap.set(date, dailyMap.get(date) + 1)
    })

    const dailyLeads = Array.from(dailyMap.entries())
        .map(([date, count]) => ({ date, leads: count }))

    // 7. Top lead source
    const topSource = leadsWithROI[0] || { source: 'N/A', medium: 'N/A', count: 0 }
    const topSourceText = `${topSource.source}/${topSource.medium}`

    // 8. New leads count - leads created after last view
    // Get last view timestamp for this user
    const { data: { user } } = await supabase.auth.getUser()
    let newLeadsCount = 0

    if (user) {
        const { data: activity } = await supabase
            .from('user_dashboard_activity')
            .select('last_leads_view')
            .eq('user_id', user.id)
            .eq('client_id', clientId)
            .single()

        const lastView = activity?.last_leads_view

        if (lastView) {
            // Count leads created after last view
            newLeadsCount = leads?.filter(l => new Date(l.created_at) > new Date(lastView)).length || 0
        } else {
            // If never viewed, all leads are new
            newLeadsCount = leads?.length || 0
        }
    } else {
        // Fallback to status-based count if not authenticated
        newLeadsCount = leads?.filter(l => l.status === 'new' || !l.status).length || 0
    }

    const { data: recentLeads } = await supabase
        .from('leads')
        .select(leadListSelect)
        .eq('client_id', clientId)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false })
        .range(0, DEFAULT_LEADS_PAGE_SIZE - 1)

    const recentLeadsWithConsent = await attachConsentStatus((recentLeads || []) as LeadListItem[], clientId)

    return {
        stats: {
            totalLeads,
            costPerLead,
            topSource: topSourceText,
            leadsInPeriod: totalLeads, // All leads in selected period
            timeLabel, // Dynamic label: "Today", "This Week", etc.
            newLeadsCount,
        },
        leadsByFormType,
        leadsBySource: leadsWithROI,
        recentLeads: recentLeadsWithConsent,
        recentLeadsTotal: totalLeads,
        chartData: dailyLeads,
    }
}

export async function getLeadListPage(
    clientId: string,
    scope: LeadListScope = 'period',
    startDate?: string,
    endDate?: string,
    limit: number = DEFAULT_LEADS_PAGE_SIZE,
    offset: number = 0
): Promise<LeadListPage> {
    const supabase = await createClient()

    const safeLimit = Math.max(1, Math.min(limit, 100))
    const safeOffset = Math.max(0, offset)
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const end = endDate || new Date().toISOString()

    let query = supabase
        .from('leads')
        .select(leadListSelect, { count: 'exact' })
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .range(safeOffset, safeOffset + safeLimit - 1)

    if (scope === 'period') {
        query = query
            .gte('created_at', start)
            .lte('created_at', end)
    }

    const { data, count, error } = await query

    if (error) {
        console.error('Error fetching lead list page:', error)
        return {
            leads: [],
            total: 0,
            hasMore: false,
            scope,
        }
    }

    const total = count || 0
    const leads = await attachConsentStatus((data || []) as LeadListItem[], clientId)

    return {
        leads,
        total,
        hasMore: safeOffset + leads.length < total,
        scope,
    }
}

export async function updateLeadStatus(
    leadId: string,
    status: string,
    dealValue?: number
) {
    const supabase = await createClient()

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
        return { success: false, error: 'Not authenticated' }
    }

    const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.id)
        .single()

    if (clientError || !client) {
        return { success: false, error: 'Client not found' }
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_KEY
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

    if (!serviceRoleKey || !supabaseUrl) {
        return { success: false, error: 'Missing Supabase server configuration' }
    }

    const adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey)

    const updates: {
        status: string
        status_updated_at: string
        deal_value?: number
    } = {
        status,
        status_updated_at: new Date().toISOString()
    }

    if (dealValue !== undefined) {
        updates.deal_value = dealValue
    }

    const { data, error } = await adminClient
        .from('leads')
        .update(updates)
        .eq('client_id', client.client_id)
        .eq('id', leadId)
        .select('id')
        .maybeSingle()

    if (error) {
        console.error('Error updating lead status:', error)
        return { success: false, error: error.message }
    }

    if (!data) {
        return { success: false, error: 'Lead not found or update not permitted' }
    }

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/leads')
    return { success: true }
}

type PushLeadResult =
    | { success: true; pushedAt: string; pushedValue: number | null }
    | { success: false; error: string }

// Manually push a lead into the separate "HaloTrack Manual Push" Google Ads
// conversion feed (src/app/api/export/google-conversions-manual). This just
// marks the lead — the actual upload happens on Google's next scheduled pull.
//
// manual_google_push_at is set once and never overwritten on later calls (so
// the CSV's Conversion Time stays stable across re-pulls for Google's
// click-id+name+time dedup) — enforced here via a single atomic conditional
// UPDATE (WHERE manual_google_push_at IS NULL) rather than a SELECT-then-
// UPDATE, which would race under two concurrent first-time pushes for the
// same lead. manual_google_push_updated_at is bumped on every call (push AND
// later value edits) so the export route's rolling window still picks up an
// edit made long after the original push — see the migration comment.
//
// Explicit PushLeadResult return type (rather than relying on inference) so
// `success` is a true discriminant — without it, TS widens `success: true` /
// `success: false` to plain `boolean` across the multiple return statements,
// and `!result.success` no longer narrows away the error-shaped variant,
// leaving `result.pushedAt` typed `string | undefined` at every call site.
export async function pushLeadToGoogleAds(leadId: string, value?: number): Promise<PushLeadResult> {
    const supabase = await createClient()

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
        return { success: false, error: 'Not authenticated' }
    }

    const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.id)
        .single()

    if (clientError || !client) {
        return { success: false, error: 'Client not found' }
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_KEY
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

    if (!serviceRoleKey || !supabaseUrl) {
        return { success: false, error: 'Missing Supabase server configuration' }
    }

    const adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey)
    const now = new Date().toISOString()

    // Atomic first-push attempt: only matches if manual_google_push_at is
    // still null. Postgres row-level locking means at most one concurrent
    // call can match this WHERE clause for a given lead.
    const { data: firstPush, error: firstPushError } = await adminClient
        .from('leads')
        .update({
            manual_google_push_at: now,
            manual_google_push_updated_at: now,
            manual_google_push_value: value ?? null,
        })
        .eq('client_id', client.client_id)
        .eq('id', leadId)
        .is('manual_google_push_at', null)
        .select('id, manual_google_push_at, manual_google_push_value')
        .maybeSingle()

    if (firstPushError) {
        console.error('Error pushing lead to Google Ads:', firstPushError)
        return { success: false, error: firstPushError.message }
    }

    if (firstPush) {
        revalidatePath('/dashboard')
        revalidatePath('/dashboard/leads')
        return {
            success: true,
            pushedAt: firstPush.manual_google_push_at as string,
            pushedValue: firstPush.manual_google_push_value as number | null,
        }
    }

    // Already pushed (by this call's lead or a concurrent one that won the
    // race above) — update the value only, never touch manual_google_push_at.
    const { data, error } = await adminClient
        .from('leads')
        .update({
            manual_google_push_value: value ?? null,
            manual_google_push_updated_at: now,
        })
        .eq('client_id', client.client_id)
        .eq('id', leadId)
        .select('id, manual_google_push_at, manual_google_push_value')
        .maybeSingle()

    if (error) {
        console.error('Error pushing lead to Google Ads:', error)
        return { success: false, error: error.message }
    }

    if (!data) {
        return { success: false, error: 'Lead not found or update not permitted' }
    }

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/leads')
    return {
        success: true,
        pushedAt: data.manual_google_push_at as string,
        pushedValue: data.manual_google_push_value as number | null,
    }
}

export async function getPipelineMetrics(
    clientId: string,
    startDate?: string,
    endDate?: string,
    attributionModel: string = 'last_touch'
): Promise<PipelineMetricsData> {
    const supabase = await createClient()

    // Default to last 30 days if no dates provided
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const end = endDate || new Date().toISOString()

    const { data: leads, error } = await supabase
        .from('leads')
        .select('status, source, deal_value, attribution_data, session_id')
        .eq('client_id', clientId)
        .gte('created_at', start)
        .lte('created_at', end)

    if (error) {
        console.error('Error fetching pipeline metrics:', error)
        return { total: 0, statusCounts: {}, winRate: 0, bySource: [] }
    }

    const total = leads.length
    const statusCounts = leads.reduce((acc, lead) => {
        const s = lead.status || 'new'
        acc[s] = (acc[s] || 0) + 1
        return acc
    }, {} as Record<string, number>)

    // Win Rate (Won / Total)
    const won = statusCounts['won'] || 0
    const winRate = total > 0 ? (won / total) * 100 : 0

    // FETCH TOUCHPOINTS for these leads if model is not Single Touch
    const leadTouchpointsMap = new Map<string, TouchpointRow[]>()

    if (['linear', 'time_decay', 'position_based', 'u_shaped'].includes(attributionModel)) {
        const sessionIds = leads?.map(l => l.session_id).filter(Boolean) || []

        if (sessionIds.length > 0) {
            const { data: touches } = await supabase
                .from('touchpoints')
                .select('*')
                .in('session_id', sessionIds)
                .order('timestamp', { ascending: true })

            touches?.forEach((t) => {
                // Group by session (Visitor)
                // Note: Leads link to session_id (Visitor).
                if (!leadTouchpointsMap.has(t.session_id)) {
                    leadTouchpointsMap.set(t.session_id, [])
                }
                leadTouchpointsMap.get(t.session_id)?.push(t)
            })
        }
    }

    // HELPER: Distribute Credit
    const distributeCredit = (lead: PipelineLeadRow, model: string): Record<string, number> => {
        const touches = lead.session_id ? (leadTouchpointsMap.get(lead.session_id) || []) : []
        // Filter valid marketing touches
        const marketingTouches = touches.filter((t) => t.source && t.source !== 'direct' && t.medium !== '(none)')

        const credit: Record<string, number> = {}

        // Fallback to Last Touch / Lead Source if no history or model is simple
        if (marketingTouches.length === 0 || ['last_touch', 'first_touch'].includes(model)) {
            let source = 'Direct / (none)'

            if (model === 'first_touch') {
                if (lead.attribution_data?.first_touch?.source) {
                    source = `${lead.attribution_data.first_touch.source} / ${lead.attribution_data.first_touch.medium || '(none)'}`
                } else if (lead.source) {
                    source = lead.source // Fallback
                }
            } else {
                // Last Touch (Default)
                if (lead.attribution_data?.last_touch?.source) {
                    source = `${lead.attribution_data.last_touch.source} / ${lead.attribution_data.last_touch.medium || '(none)'}`
                } else if (lead.source) {
                    source = lead.source
                }
            }

            credit[source] = 1
            return credit
        }

        // Multi-touch Logic
        const total = marketingTouches.length

        marketingTouches.forEach((t, index) => {
            const key = `${t.source} / ${t.medium || '(none)'}`
            let points = 0

            if (model === 'linear') {
                points = 1 / total
            } else if (model === 'position_based' || model === 'u_shaped') {
                // 40% First, 40% Last, 20% Middle
                if (total === 1) points = 1
                else if (total === 2) points = 0.5
                else {
                    if (index === 0) points = 0.4
                    else if (index === total - 1) points = 0.4
                    else points = 0.2 / (total - 2)
                }
            } else if (model === 'time_decay') {
                // Simple version: 2^x decay? Or simple linear decay?
                // Let's use 2^(-days_ago/7) (7 day half-life)
                // Need access to touch timestamp vs lead conversion time.
                // Simplified: Just Linear for now to ensure MVP works, or user simple weight
                points = 1 / total // Placeholder for complex math if requested
            }

            credit[key] = (credit[key] || 0) + points
        })

        return credit
    }

    // By Source logic (Weighted)
    const sourceStats: Record<string, { total: number, won: number, value: number }> = {}

    leads.forEach(lead => {
        const credits = distributeCredit(lead, attributionModel || 'last_touch')

        Object.entries(credits).forEach(([source, weight]) => {
            if (!sourceStats[source]) {
                sourceStats[source] = { total: 0, won: 0, value: 0 }
            }
            // Add weighted total
            sourceStats[source].total += weight

            // If won, add weighted value/count
            if (lead.status === 'won') {
                sourceStats[source].won += weight
                sourceStats[source].value += (Number(lead.deal_value || 0) * weight)
            }
        })
    })

    const bySource = Object.entries(sourceStats)
        .map(([source, stats]) => ({
            source,
            total: Number(stats.total.toFixed(2)),
            won: Number(stats.won.toFixed(2)),
            value: stats.value,
            winRate: stats.total > 0 ? (stats.won / stats.total) * 100 : 0
        }))
        .sort((a, b) => b.value - a.value) // Sort by value first, or total? Let's do Value for importance.

    return {
        total,
        statusCounts,
        winRate,
        bySource
    }
}
