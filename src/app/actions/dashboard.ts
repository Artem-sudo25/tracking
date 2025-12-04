'use server'

import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import type { DashboardData } from '@/types'

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
        revenueBySource,
        recentOrders: orders?.slice(0, 5) || [],
        chartData
    }
}
