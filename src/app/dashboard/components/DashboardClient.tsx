'use client'

import { useState, useEffect } from 'react'
import { DateRange } from '@/types'
import type { DashboardData } from '@/types'
import { getDashboardData } from '@/app/actions/dashboard'
import { DateRangePicker } from './DateRangePicker'
import { StatsCards } from './StatsCards'
import { RevenueBySource } from './RevenueBySource'
import { RevenueChart } from './RevenueChart'
import { RecentOrders } from './RecentOrders'

interface DashboardClientProps {
  clientId: string
  initialData: DashboardData
}

export function DashboardClient({ clientId, initialData }: DashboardClientProps) {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const today = new Date()
    const thirtyDaysAgo = new Date(today)
    thirtyDaysAgo.setDate(today.getDate() - 30)
    return { from: thirtyDaysAgo, to: today }
  })

  const [data, setData] = useState<DashboardData>(initialData)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    async function fetchData() {
      if (!dateRange.from || !dateRange.to) return

      setIsLoading(true)
      try {
        const newData = await getDashboardData(
          clientId,
          dateRange.from.toISOString(),
          dateRange.to.toISOString()
        )
        setData(newData)
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [clientId, dateRange])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">Overview of your attribution performance.</p>
        </div>
        <DateRangePicker date={dateRange} onDateChange={setDateRange} />
      </div>

      <div className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
        <StatsCards
          totalRevenue={data.stats.totalRevenue}
          totalOrders={data.stats.totalOrders}
          attributionRate={data.stats.attributionRate}
          avgDaysToConvert={data.stats.avgDaysToConvert}
        />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7 mt-8">
          <RevenueChart data={data.chartData} />
          <RecentOrders orders={data.recentOrders} />
        </div>

        <div className="grid gap-4 md:grid-cols-1 mt-8">
          <RevenueBySource data={data.revenueBySource} />
        </div>
      </div>

      {isLoading && (
        <div className="fixed bottom-4 right-4 bg-background border rounded-lg px-4 py-2 shadow-lg">
          <p className="text-sm">Updating data...</p>
        </div>
      )}
    </div>
  )
}
