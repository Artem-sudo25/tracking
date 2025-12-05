'use server'

import { createClient } from '@/lib/supabase/server'

export async function getVisitorAnalytics(
    clientId: string,
    startDate?: string,
    endDate?: string
) {
    const supabase = await createClient()

    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const end = endDate || new Date().toISOString()

    // Get all sessions in period
    const { data: sessions } = await supabase
        .from('sessions')
        .select('*')
        .eq('client_id', clientId)
        .gte('created_at', start)
        .lte('created_at', end)

    // Count UNIQUE visitors using ip_hash
    const uniqueVisitorIds = new Set(sessions?.map(s => s.ip_hash || s.session_id) || [])
    const totalVisitors = uniqueVisitorIds.size

    // For page views and bounce rate, we need to aggregate by unique visitor (ip_hash)
    const visitorMap = new Map()
    sessions?.forEach(s => {
        const vid = s.ip_hash || s.session_id
        if (!visitorMap.has(vid)) {
            visitorMap.set(vid, {
                pageViews: s.page_views || 1, // Start with page views from this session
                source: s.ft_source || 'Direct',
                medium: s.ft_medium || '(none)',
                sessions: 1
            })
        } else {
            // Aggregate page views for same visitor across multiple sessions
            const existing = visitorMap.get(vid)
            existing.pageViews += (s.page_views || 1)
            existing.sessions += 1
        }
    })

    const uniqueVisitors = Array.from(visitorMap.values())

    // Calculate total page views
    const totalPageViews = sessions?.reduce((sum, s) => sum + (s.page_views || 1), 0) || 0

    // Calculate bounce rate (visitors with only 1 page view total)
    const bounces = uniqueVisitors.filter(v => v.pageViews === 1).length
    const bounceRate = totalVisitors > 0 ? (bounces / totalVisitors) * 100 : 0

    // Pages per session (actually pages per visitor now, more accurate)
    const pagesPerSession = totalVisitors > 0 ? totalPageViews / totalVisitors : 0

    // Get leads count
    const { count: leadsCount } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('created_at', start)
        .lte('created_at', end)

    // Get customers count (purchases with lead_id)
    const { count: customersCount } = await supabase
        .from('purchases')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('created_at', start)
        .lte('created_at', end)
        .not('lead_id', 'is', null)

    // Calculate conversion rates
    const visitorToLeadRate = totalVisitors > 0 ? ((leadsCount || 0) / totalVisitors) * 100 : 0
    const leadToCustomerRate = (leadsCount || 0) > 0 ? ((customersCount || 0) / (leadsCount || 1)) * 100 : 0
    const visitorToCustomerRate = totalVisitors > 0 ? ((customersCount || 0) / totalVisitors) * 100 : 0

    // Visitors by source (using unique visitors)
    const sourceMap = new Map()
    uniqueVisitors.forEach(v => {
        const key = `${v.source}/${v.medium}`

        if (!sourceMap.has(key)) {
            sourceMap.set(key, {
                source: v.source,
                medium: v.medium,
                visitors: 0,
                bounces: 0,
            })
        }

        const entry = sourceMap.get(key)
        entry.visitors += 1
        if (v.pageViews === 1) {
            entry.bounces += 1
        }
    })

    const visitorsBySource = Array.from(sourceMap.values())
        .map(s => ({
            ...s,
            bounceRate: s.visitors > 0 ? (s.bounces / s.visitors) * 100 : 0
        }))
        .sort((a, b) => b.visitors - a.visitors)

    return {
        totalVisitors,
        totalPageViews,
        bounceRate: Math.min(bounceRate, 100), // Cap at 100% just in case
        pagesPerSession,
        leadsCount: leadsCount || 0,
        customersCount: customersCount || 0,
        visitorToLeadRate,
        leadToCustomerRate,
        visitorToCustomerRate,
        visitorsBySource,
    }
}
