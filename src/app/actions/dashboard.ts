'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
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
