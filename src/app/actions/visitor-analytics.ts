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

    // Count UNIQUE session_ids (like Google Analytics unique visitors)
    const uniqueSessionIds = new Set(sessions?.map(s => s.session_id) || [])
    const totalVisitors = uniqueSessionIds.size

    // For page views and bounce rate, we need to aggregate by session_id
    const sessionMap = new Map()
    sessions?.forEach(s => {
        const sid = s.session_id
        if (!sessionMap.has(sid)) {
            sessionMap.set(sid, {
                pageViews: s.page_views || 1,
                source: s.ft_source || 'Direct',
                medium: s.ft_medium || '(none)',
            })
        } else {
            // If multiple records for same session, take the max page_views
            const existing = sessionMap.get(sid)
            existing.pageViews = Math.max(existing.pageViews, s.page_views || 1)
        }
    })

    const uniqueSessions = Array.from(sessionMap.values())

    // Calculate total page views from unique sessions
    const totalPageViews = uniqueSessions.reduce((sum, s) => sum + s.pageViews, 0)

    // Calculate bounce rate (sessions with only 1 page view)
    const bounces = uniqueSessions.filter(s => s.pageViews === 1).length
    const bounceRate = totalVisitors > 0 ? (bounces / totalVisitors) * 100 : 0

    // Pages per session
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

    // Visitors by source (using unique sessions)
    const sourceMap = new Map()
    uniqueSessions.forEach(s => {
        const key = `${s.source}/${s.medium}`

        if (!sourceMap.has(key)) {
            sourceMap.set(key, {
                source: s.source,
                medium: s.medium,
                visitors: 0,
                bounces: 0,
            })
        }

        const entry = sourceMap.get(key)
        entry.visitors += 1
        if (s.pageViews === 1) {
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
        bounceRate,
        pagesPerSession,
        leadsCount: leadsCount || 0,
        customersCount: customersCount || 0,
        visitorToLeadRate,
        leadToCustomerRate,
        visitorToCustomerRate,
        visitorsBySource,
    }
}
