'use server'

import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'

export interface EcommerceVisitorData {
    totalSessions: number
    totalPageViews: number
    pagesPerSession: number
    conversionRate: number
    sessionsByDay: { date: string; sessions: number }[]
    topSources: { source: string; medium: string; sessions: number; pct: number }[]
    topLandingPages: { page: string; sessions: number; pct: number }[]
    deviceBreakdown: { type: string; sessions: number; pct: number }[]
}

export async function getEcommerceVisitorData(
    clientId: string,
    startDate?: string,
    endDate?: string
): Promise<EcommerceVisitorData> {
    const supabase = await createClient()

    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const end = endDate || new Date().toISOString()

    const [{ data: sessions }, { count: ordersCount }] = await Promise.all([
        supabase
            .from('sessions')
            .select('session_id, created_at, ft_source, ft_medium, ft_landing, device_type, ip_hash')
            .eq('client_id', clientId)
            .gte('created_at', start)
            .lte('created_at', end),
        supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', clientId)
            .gte('created_at', start)
            .lte('created_at', end),
    ])

    const rows = sessions || []
    const totalSessions = rows.length

    // Deduplicate page views: same ip_hash within 5s = one view
    const visitorMap = new Map<string, number[]>()
    rows.forEach(s => {
        const vid = s.ip_hash || s.session_id
        if (!visitorMap.has(vid)) visitorMap.set(vid, [])
        visitorMap.get(vid)!.push(new Date(s.created_at).getTime())
    })

    let totalPageViews = 0
    visitorMap.forEach(times => {
        times.sort((a, b) => a - b)
        let views = 0
        let last = 0
        times.forEach(t => { if (t - last > 5000) { views++; last = t } })
        totalPageViews += Math.max(views, 1)
    })

    const pagesPerSession = totalSessions > 0 ? totalPageViews / totalSessions : 0
    const conversionRate = totalSessions > 0 ? ((ordersCount || 0) / totalSessions) * 100 : 0

    // Sessions by day
    const dayMap = new Map<string, number>()
    rows.forEach(s => {
        const d = format(new Date(s.created_at), 'MMM d')
        dayMap.set(d, (dayMap.get(d) || 0) + 1)
    })
    const sessionsByDay = Array.from(dayMap.entries())
        .map(([date, sessions]) => ({ date, sessions }))

    // Top sources
    const sourceMap = new Map<string, number>()
    rows.forEach(s => {
        const key = `${s.ft_source || 'direct'}|||${s.ft_medium || '(none)'}`
        sourceMap.set(key, (sourceMap.get(key) || 0) + 1)
    })
    const topSources = Array.from(sourceMap.entries())
        .map(([key, count]) => {
            const [source, medium] = key.split('|||')
            return { source, medium, sessions: count, pct: totalSessions > 0 ? (count / totalSessions) * 100 : 0 }
        })
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 8)

    // Top landing pages
    const pageMap = new Map<string, number>()
    rows.forEach(s => {
        const page = s.ft_landing || '/'
        pageMap.set(page, (pageMap.get(page) || 0) + 1)
    })
    const topLandingPages = Array.from(pageMap.entries())
        .map(([page, count]) => ({ page, sessions: count, pct: totalSessions > 0 ? (count / totalSessions) * 100 : 0 }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 8)

    // Device breakdown
    const deviceMap = new Map<string, number>()
    rows.forEach(s => {
        const type = s.device_type || 'unknown'
        deviceMap.set(type, (deviceMap.get(type) || 0) + 1)
    })
    const deviceBreakdown = Array.from(deviceMap.entries())
        .map(([type, count]) => ({ type, sessions: count, pct: totalSessions > 0 ? (count / totalSessions) * 100 : 0 }))
        .sort((a, b) => b.sessions - a.sessions)

    return {
        totalSessions,
        totalPageViews,
        pagesPerSession,
        conversionRate,
        sessionsByDay,
        topSources,
        topLandingPages,
        deviceBreakdown,
    }
}
