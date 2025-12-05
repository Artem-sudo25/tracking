'use client'

import { useState, useEffect } from 'react'
import { DateRange } from '@/types'
import type { DashboardData } from '@/types'
import { getDashboardData, getLeadsDashboardData } from '@/app/actions/dashboard'
import { getVisitorAnalytics } from '@/app/actions/visitor-analytics'
import { DateRangePicker } from './DateRangePicker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CalendarDateRange } from 'react-day-picker'
import { Presentation } from 'lucide-react' // Use Presentation as icon for Pipeline
import Link from 'next/link'
import { ViewToggle } from './ViewToggle'
import { StatsCards } from './StatsCards'
import { LeadsStatsCards } from './LeadsStatsCards'
import { LeadsBySource } from './LeadsBySource'
import { RevenueBySource } from './RevenueBySource'
import { RevenueChart } from './RevenueChart'
import { RecentOrders } from './RecentOrders'
import { RecentLeads } from './RecentLeads'
import { VisitorAnalytics } from './VisitorAnalytics'

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
  const [visitorData, setVisitorData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Save view preference to localStorage
  useEffect(() => {
    localStorage.setItem('dashboard_view', currentView)
  }, [currentView])

  const showLeads = currentView === 'leads' || currentView === 'combined'
  const showPurchases = currentView === 'purchases' || currentView === 'combined'

  // Fetch data when date range or view changes
  useEffect(() => {
    async function fetchData() {
      if (!dateRange.from || !dateRange.to) return

      setIsLoading(true)
      const start = dateRange.from.toISOString()
      const end = dateRange.to.toISOString()

      // Fetch data in parallel based on current view
      const promises = []

      if (showPurchases) {
        promises.push(getDashboardData(clientId, start, end))
      }

      if (showLeads) {
        promises.push(getLeadsDashboardData(clientId, start, end))
        promises.push(getVisitorAnalytics(clientId, start, end))
      }

      try {
        const results = await Promise.all(promises)

        if (showPurchases && showLeads) {
          setPurchasesData(results[0])
          setLeadsData(results[1])
          setVisitorData(results[2])
        } else if (showPurchases) {
          setPurchasesData(results[0])
        } else if (showLeads) {
          setLeadsData(results[0])
          setVisitorData(results[1])
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [clientId, dateRange, currentView, showLeads, showPurchases])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Overview of your attribution performance.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Link href="/dashboard/leads">
            <Button variant="outline">
              <Presentation className="mr-2 h-4 w-4" />
              Pipeline
            </Button>
          </Link>
          <DateRangePicker
            date={dateRange}
            onDateChange={(range) => {
              if (range?.from && range?.to) {
                setDateRange(range)
              }
            }}
          />
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
              clientId={clientId}
              totalLeads={leadsData.stats.totalLeads}
              costPerLead={leadsData.stats.costPerLead}
              leadsInPeriod={leadsData.stats.leadsInPeriod}
              timeLabel={leadsData.stats.timeLabel}
              newLeadsCount={leadsData.stats.newLeadsCount}
            />

            {visitorData && (
              <div className="mt-8">
                <h4 className="text-xl font-bold mb-4">Visitor Analytics</h4>
                <VisitorAnalytics data={visitorData} />
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-1 mt-4">
              <LeadsBySource data={leadsData.leadsBySource} />
            </div>

            <div className="grid gap-4 md:grid-cols-1 mt-4">
              <RecentLeads leads={leadsData.recentLeads} />
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
