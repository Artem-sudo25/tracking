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

    // Deduplicate sessions (page views) per visitor
    // If a visitor has multiple "sessions" (page views) within 5 seconds, treat them as one.
    const visitorMap = new Map()

    // Group all sessions by visitor first
    sessions?.forEach(s => {
        const vid = s.ip_hash || s.session_id
        if (!visitorMap.has(vid)) {
            visitorMap.set(vid, [])
        }
        visitorMap.get(vid).push({
            ...s,
            parsedDate: new Date(s.created_at).getTime()
        })
    })

    // Process each visitor's sessions to deduplicate and aggregate
    const uniqueVisitors: any[] = []
    let totalDeduplicatedPageViews = 0

    visitorMap.forEach((visitorSessions, vid) => {
        // Sort by time
        visitorSessions.sort((a: any, b: any) => a.parsedDate - b.parsedDate)

        let validPageViews = 0
        let lastViewTime = 0
        let isBounce = true // Assume bounce until proven otherwise (views > 1)

        // Track sources for this visitor (use first non-direct if available, or just first)
        let primarySource = visitorSessions[0].ft_source || 'Direct'
        let primaryMedium = visitorSessions[0].ft_medium || '(none)'

        visitorSessions.forEach((s: any) => {
            // Check if this view is unique enough (e.g. > 5 seconds after last valid view)
            if (s.parsedDate - lastViewTime > 5000) {
                validPageViews++
                lastViewTime = s.parsedDate
            }
        })

        // Accumulate total metrics
        totalDeduplicatedPageViews += validPageViews

        uniqueVisitors.push({
            vid,
            pageViews: validPageViews,
            source: primarySource,
            medium: primaryMedium,
            sessions: visitorSessions.length // Raw sessions count for debug if needed
        })
    })

    // Update total page views to be the deduplicated count
    const totalPageViews = totalDeduplicatedPageViews // Was sessions.length or sum(page_views)

    // Calculate bounce rate (visitors with only 1 deduplicated page view)
    // Note: If validPageViews is 0 (shouldn't happen), it's not a bounce (it's a ghost?). 1 is a bounce.
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

    // Visitors by source (using unique visitors and deduplicated stats)
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
