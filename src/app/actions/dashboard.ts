'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { differenceInDays, differenceInHours, format } from 'date-fns'
import type { DashboardData } from '@/types'

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
        recentOrders: orders?.slice(0, 5) || [],
        chartData
    }
}

export async function getLeadsDashboardData(
    clientId: string,
    startDate?: string,
    endDate?: string
): Promise<any> {
    const supabase = await createClient()

    // Use provided dates or default to last 30 days
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const end = endDate || new Date().toISOString()

    // Calculate dynamic time label based on date range
    const startDateObj = new Date(start)
    const endDateObj = new Date(end)
    const daysDiff = differenceInDays(endDateObj, startDateObj)
    const hoursDiff = differenceInHours(endDateObj, startDateObj)

    let timeLabel = 'in Period'
    if (hoursDiff < 24) timeLabel = 'Today'
    else if (daysDiff === 1) timeLabel = 'Yesterday'
    else if (daysDiff <= 7) timeLabel = 'This Week'
    else if (daysDiff <= 30) timeLabel = 'This Month'
    else if (daysDiff <= 90) timeLabel = 'This Quarter'

    // 1. Fetch all leads
    const { data: leads } = await supabase
        .from('leads')
        .select('*')
        .eq('client_id', clientId)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false })

    const totalLeads = leads?.length || 0

    // 2. Fetch purchases to calculate conversion rate
    const { data: purchases } = await supabase
        .from('purchases')
        .select('lead_id')
        .eq('client_id', clientId)
        .gte('created_at', start)
        .lte('created_at', end)
        .not('lead_id', 'is', null)

    const convertedLeads = new Set(purchases?.map(p => p.lead_id) || [])
    const conversionRate = totalLeads > 0 ? convertedLeads.size / totalLeads : 0

    // 3. Cost per lead (CPL)
    // Get ad spend for the period
    const { data: adSpendData } = await supabase
        .from('ad_spend')
        .select('spend')
        .eq('client_id', clientId)
        .gte('date', start)
        .lte('date', end)

    const totalSpend = adSpendData?.reduce((sum, s) => sum + (s.spend || 0), 0) || 0
    const costPerLead = totalLeads > 0 ? totalSpend / totalLeads : 0

    // 4. Leads by form type
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

    // 5. Leads by source (first touch) - include ALL leads
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

    // 6. Get ad spend for this period and calculate lead-gen ROI
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

    // 7. Leads over time (daily)
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

    // 8. Top lead source
    const topSource = leadsWithROI[0] || { source: 'N/A', medium: 'N/A', count: 0 }
    const topSourceText = `${topSource.source}/${topSource.medium}`

    // 9. New leads count - leads created after last view
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
        recentLeads: leads?.slice(0, 5) || [],
        chartData: dailyLeads,
    }
}

export async function updateLeadStatus(
    leadId: string,
    status: string,
    dealValue?: number
) {
    const supabase = await createClient()

    const updates: any = {
        status,
        status_updated_at: new Date().toISOString()
    }

    if (dealValue !== undefined) {
        updates.deal_value = dealValue
    }

    const { error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', leadId)

    if (error) {
        console.error('Error updating lead status:', error)
        return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/leads')
    return { success: true }
}

export async function getPipelineMetrics(
    clientId: string,
    startDate?: string,
    endDate?: string,
    attributionModel: string = 'last_touch'
) {
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
    let leadTouchpointsMap = new Map<string, any[]>()

    if (['linear', 'time_decay', 'position_based', 'u_shaped'].includes(attributionModel)) {
        const sessionIds = leads?.map(l => l.session_id).filter(Boolean) || []

        if (sessionIds.length > 0) {
            const { data: touches } = await supabase
                .from('touchpoints')
                .select('*')
                .in('session_id', sessionIds)
                .order('timestamp', { ascending: true })

            touches?.forEach(t => {
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
    const distributeCredit = (lead: any, model: string): Record<string, number> => {
        const touches = leadTouchpointsMap.get(lead.session_id) || []
        // Filter valid marketing touches
        const marketingTouches = touches.filter(t => t.source && t.source !== 'direct' && t.medium !== '(none)')

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
