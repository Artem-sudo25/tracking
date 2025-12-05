'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, Eye, TrendingDown, FileText, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VisitorAnalyticsProps {
    data: {
        totalVisitors: number
        totalPageViews: number
        bounceRate: number
        pagesPerSession: number
        leadsCount: number
        customersCount: number
        visitorToLeadRate: number
        leadToCustomerRate: number
        visitorToCustomerRate: number
        visitorsBySource: Array<{
            source: string
            medium: string
            visitors: number
            bounceRate: number
        }>
    }
}

export function VisitorAnalytics({ data }: VisitorAnalyticsProps) {
    const getBounceRateColor = (rate: number) => {
        if (rate < 40) return 'text-green-600'
        if (rate < 60) return 'text-yellow-600'
        return 'text-red-600'
    }

    return (
        <div className="space-y-4">
            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Visitors</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{data.totalVisitors.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground">
                            Unique sessions
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Page Views</CardTitle>
                        <Eye className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{data.totalPageViews.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground">
                            {data.pagesPerSession.toFixed(1)} per session
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Bounce Rate</CardTitle>
                        <TrendingDown className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className={cn("text-2xl font-bold", getBounceRateColor(data.bounceRate))}>
                            {data.bounceRate.toFixed(1)}%
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Single-page sessions
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Visitor → Lead</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{data.visitorToLeadRate.toFixed(1)}%</div>
                        <p className="text-xs text-muted-foreground">
                            Conversion rate
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Conversion Funnel */}
            <Card>
                <CardHeader>
                    <CardTitle>Conversion Funnel</CardTitle>
                    <CardDescription>Visitor journey from first touch to customer</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between">
                        {/* Visitors */}
                        <div className="flex-1 text-center">
                            <div className="text-3xl font-bold text-blue-600">{data.totalVisitors}</div>
                            <p className="text-sm text-muted-foreground mt-1">Visitors</p>
                            <p className="text-xs text-muted-foreground">100%</p>
                        </div>

                        <ArrowRight className="h-6 w-6 text-muted-foreground mx-2" />

                        {/* Leads */}
                        <div className="flex-1 text-center">
                            <div className="text-3xl font-bold text-green-600">{data.leadsCount}</div>
                            <p className="text-sm text-muted-foreground mt-1">Leads</p>
                            <p className="text-xs font-medium text-green-600">
                                {data.visitorToLeadRate.toFixed(1)}%
                            </p>
                        </div>

                        <ArrowRight className="h-6 w-6 text-muted-foreground mx-2" />

                        {/* Customers */}
                        <div className="flex-1 text-center">
                            <div className="text-3xl font-bold text-purple-600">{data.customersCount}</div>
                            <p className="text-sm text-muted-foreground mt-1">Customers</p>
                            <p className="text-xs font-medium text-purple-600">
                                {data.visitorToCustomerRate.toFixed(1)}%
                            </p>
                        </div>
                    </div>

                    {/* Funnel Visualization */}
                    <div className="mt-6 space-y-2">
                        <div className="w-full bg-blue-100 rounded-full h-3">
                            <div className="bg-blue-600 h-3 rounded-full" style={{ width: '100%' }}></div>
                        </div>
                        <div className="w-full bg-green-100 rounded-full h-3">
                            <div className="bg-green-600 h-3 rounded-full" style={{ width: `${data.visitorToLeadRate}%` }}></div>
                        </div>
                        <div className="w-full bg-purple-100 rounded-full h-3">
                            <div className="bg-purple-600 h-3 rounded-full" style={{ width: `${data.visitorToCustomerRate}%` }}></div>
                        </div>
                    </div>

                    {data.leadToCustomerRate > 0 && (
                        <p className="text-sm text-muted-foreground mt-4 text-center">
                            <span className="font-medium">{data.leadToCustomerRate.toFixed(1)}%</span> of leads convert to customers
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* Visitors by Source with Bounce Rate */}
            {data.visitorsBySource.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Traffic Sources</CardTitle>
                        <CardDescription>Visitors and engagement by source</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {data.visitorsBySource.slice(0, 5).map((source, index) => (
                                <div key={`${source.source}-${source.medium}`} className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <p className="text-sm font-medium">{source.source} / {source.medium}</p>
                                        <div className="flex items-center gap-4 mt-1">
                                            <span className="text-xs text-muted-foreground">
                                                {source.visitors} visitors
                                            </span>
                                            <span className={cn("text-xs font-medium", getBounceRateColor(source.bounceRate))}>
                                                {source.bounceRate.toFixed(1)}% bounce
                                            </span>
                                        </div>
                                    </div>
                                    <div className="w-24 bg-muted rounded-full h-2">
                                        <div
                                            className="bg-primary h-2 rounded-full"
                                            style={{ width: `${(source.visitors / data.totalVisitors) * 100}%` }}
                                        ></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
