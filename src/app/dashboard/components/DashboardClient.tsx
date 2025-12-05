'use client'

import { useState, useEffect } from 'react'
import { DateRange } from '@/types'
import type { DashboardData } from '@/types'
import { getDashboardData, getLeadsDashboardData } from '@/app/actions/dashboard'
import { DateRangePicker } from './DateRangePicker'
import { ViewToggle } from './ViewToggle'
import { StatsCards } from './StatsCards'
import { LeadsStatsCards } from './LeadsStatsCards'
import { LeadsBySource } from './LeadsBySource'
import { RevenueBySource } from './RevenueBySource'
import { RevenueChart } from './RevenueChart'
import { RecentOrders } from './RecentOrders'
import { RecentLeads } from './RecentLeads'

interface DashboardClientProps {
  clientId: string
  initialData: DashboardData
}

type ViewType = 'leads' | 'purchases' | 'combined'

export function DashboardClient({ clientId, initialData }: DashboardClientProps) {
  // Load view preference from localStorage, default to 'combined'
  const [currentView, setCurrentView] = useState<ViewType>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dashboard_view')
      return (saved as ViewType) || 'combined'
    }
    return 'combined'
  })

  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const today = new Date()
    const thirtyDaysAgo = new Date(today)
    thirtyDaysAgo.setDate(today.getDate() - 30)
    return { from: thirtyDaysAgo, to: today }
  })

  const [purchasesData, setPurchasesData] = useState<DashboardData>(initialData)
  const [leadsData, setLeadsData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Save view preference to localStorage
  useEffect(() => {
    localStorage.setItem('dashboard_view', currentView)
  }, [currentView])

  // Fetch data when date range changes
  useEffect(() => {
    async function fetchData() {
      if (!dateRange.from || !dateRange.to) return

      setIsLoading(true)
      try {
        const startDate = dateRange.from.toISOString()
        const endDate = dateRange.to.toISOString()

        // Fetch both purchases and leads data in parallel
        const [newPurchasesData, newLeadsData] = await Promise.all([
          getDashboardData(clientId, startDate, endDate),
          getLeadsDashboardData(clientId, startDate, endDate)
        ])

        setPurchasesData(newPurchasesData)
        setLeadsData(newLeadsData)
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [clientId, dateRange])

  const showLeads = currentView === 'leads' || currentView === 'combined'
  const showPurchases = currentView === 'purchases' || currentView === 'combined'

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">Overview of your attribution performance.</p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <ViewToggle currentView={currentView} onChange={setCurrentView} />
          <DateRangePicker date={dateRange} onDateChange={setDateRange} />
        </div>
      </div>

      <div className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
        {/* Leads Section */}
        {showLeads && leadsData && (
          <div className="space-y-8">
            {currentView === 'combined' && (
              <h3 className="text-2xl font-bold">Leads</h3>
            )}
            <LeadsStatsCards
              totalLeads={leadsData.stats.totalLeads}
              conversionRate={leadsData.stats.conversionRate}
              avgLeadValue={leadsData.stats.avgLeadValue}
              topSource={leadsData.stats.topSource}
              leadsInPeriod={leadsData.stats.leadsInPeriod}
              timeLabel={leadsData.stats.timeLabel}
              newLeadsCount={leadsData.stats.newLeadsCount}
            />

            <div className="grid gap-4 md:grid-cols-1">
              <RecentLeads leads={leadsData.recentLeads} />
            </div>

            <div className="grid gap-4 md:grid-cols-1 mt-4">
              <LeadsBySource data={leadsData.leadsBySource} />
            </div>
          </div>
        )}

        {/* Separator for combined view */}
        {currentView === 'combined' && (
          <div className="border-t my-8" />
        )}

        {/* Purchases Section */}
        {showPurchases && (
          <div className="space-y-8">
            {currentView === 'combined' && (
              <h3 className="text-2xl font-bold">Purchases</h3>
            )}
            <StatsCards
              totalRevenue={purchasesData.stats.totalRevenue}
              totalOrders={purchasesData.stats.totalOrders}
              attributionRate={purchasesData.stats.attributionRate}
              avgDaysToConvert={purchasesData.stats.avgDaysToConvert}
            />

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
              <RevenueChart data={purchasesData.chartData} />
              <RecentOrders orders={purchasesData.recentOrders} />
            </div>

            <div className="grid gap-4 md:grid-cols-1">
              <RevenueBySource data={purchasesData.revenueBySource} />
            </div>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="fixed bottom-4 right-4 bg-background border rounded-lg px-4 py-2 shadow-lg">
          <p className="text-sm">Updating data...</p>
        </div>
      )}
    </div>
  )
}
