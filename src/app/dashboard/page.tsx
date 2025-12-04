import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getDashboardData } from '@/app/actions/dashboard'
import { StatsCards } from './components/StatsCards'
import { RevenueBySource } from './components/RevenueBySource'
import { RevenueChart } from './components/RevenueChart'
import { RecentOrders } from './components/RecentOrders'

export default async function DashboardPage() {
    const supabase = await createClient()

    // Get current user's client_id
    // In a real multi-tenant app, the user might belong to multiple clients or we need to fetch their client_id
    // For this MVP, we'll assume the user is linked to a client in the clients table
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return null

    const { data: client } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.id)
        .single()

    // If no client found, we might want to show a setup screen or error
    // For now, we'll just use a placeholder or handle gracefully
    if (!client) {
        return (
            <div className="p-8 text-center">
                <h2 className="text-2xl font-bold">No client account found</h2>
                <p className="text-muted-foreground">Please contact support to set up your account.</p>
            </div>
        )
    }

    const data = await getDashboardData(client.client_id)

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
                <p className="text-muted-foreground">Overview of your attribution performance.</p>
            </div>

            <StatsCards
                totalRevenue={data.stats.totalRevenue}
                totalOrders={data.stats.totalOrders}
                attributionRate={data.stats.attributionRate}
                avgDaysToConvert={data.stats.avgDaysToConvert}
            />

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <RevenueChart data={data.chartData} />
                <RecentOrders orders={data.recentOrders} />
            </div>

            <div className="grid gap-4 md:grid-cols-1">
                <RevenueBySource data={data.revenueBySource} />
            </div>
        </div>
    )
}
