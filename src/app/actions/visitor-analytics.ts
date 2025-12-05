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

    const totalVisitors = sessions?.length || 0

    // Calculate total page views
    const totalPageViews = sessions?.reduce((sum, s) => sum + (s.page_views || 1), 0) || 0

    // Calculate bounce rate (sessions with only 1 page view)
    const bounces = sessions?.filter(s => (s.page_views || 1) === 1).length || 0
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

    // Visitors by source
    const sourceMap = new Map()
    sessions?.forEach(s => {
        const source = s.ft_source || 'Direct'
        const medium = s.ft_medium || '(none)'
        const key = `${source}/${medium}`

        if (!sourceMap.has(key)) {
            sourceMap.set(key, {
                source,
                medium,
                visitors: 0,
                bounces: 0,
            })
        }

        const entry = sourceMap.get(key)
        entry.visitors += 1
        if ((s.page_views || 1) === 1) {
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
