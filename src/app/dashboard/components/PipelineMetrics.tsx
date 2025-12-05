'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

interface PipelineMetricsProps {
    data: {
        total: number
        statusCounts: Record<string, number>
        winRate: number
        bySource: Array<{
            source: string
            total: number
            won: number
            value: number
            winRate: number
        }>
    }
}

export function PipelineMetrics({ data }: PipelineMetricsProps) {
    const { total, statusCounts, winRate, bySource } = data

    // Helpers
    const getCount = (status: string) => statusCounts[status] || 0
    const getPercentage = (count: number) => total > 0 ? (count / total) * 100 : 0

    return (
        <div className="grid gap-4 md:grid-cols-2">
            {/* Pipeline Status Breakdown */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm font-medium">Pipeline Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">New</span>
                            <span className="font-medium">{getCount('new')} ({getPercentage(getCount('new')).toFixed(1)}%)</span>
                        </div>
                        <Progress value={getPercentage(getCount('new'))} className="bg-orange-100" />
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Contacted</span>
                            <span className="font-medium">{getCount('contacted')} ({getPercentage(getCount('contacted')).toFixed(1)}%)</span>
                        </div>
                        <Progress value={getPercentage(getCount('contacted'))} className="bg-blue-100" />
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Qualified</span>
                            <span className="font-medium">{getCount('qualified')} ({getPercentage(getCount('qualified')).toFixed(1)}%)</span>
                        </div>
                        <Progress value={getPercentage(getCount('qualified'))} className="bg-purple-100" />
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Won</span>
                            <span className="font-medium">{getCount('won')} ({getPercentage(getCount('won')).toFixed(1)}%)</span>
                        </div>
                        <Progress value={getPercentage(getCount('won'))} className="bg-green-100" />
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Lost</span>
                            <span className="font-medium">{getCount('lost')} ({getPercentage(getCount('lost')).toFixed(1)}%)</span>
                        </div>
                        <Progress value={getPercentage(getCount('lost'))} className="bg-gray-100" />
                    </div>
                </CardContent>
            </Card>

            {/* Win Rate & Value by Source */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm font-medium">Performance by Source</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {bySource.slice(0, 5).map((source) => (
                            <div key={source.source} className="space-y-1">
                                <div className="flex items-center justify-between text-sm">
                                    <div>
                                        <span className="font-medium">{source.source}</span>
                                        <span className="text-muted-foreground text-xs ml-2">
                                            ({source.won}/{source.total} won)
                                        </span>
                                    </div>
                                    <div className="text-right">
                                        <span className="block font-medium text-green-700">
                                            {new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(source.value)}
                                        </span>
                                        <span className={`text-xs ${source.winRate > 20 ? 'text-green-600' : 'text-muted-foreground'}`}>
                                            {source.winRate.toFixed(1)}% win rate
                                        </span>
                                    </div>
                                </div>
                                <Progress value={source.winRate} className="h-2" />
                            </div>
                        ))}
                        {bySource.length > 0 && (
                            <div className="pt-4 border-t text-sm text-muted-foreground">
                                <span className="font-medium text-foreground">Key Insight: </span>
                                {bySource.map(s => `${s.source} leads close at ${s.winRate.toFixed(0)}%`).join(', ')}.
                            </div>
                        )}
                        {bySource.length === 0 && (
                            <p className="text-sm text-muted-foreground text-center py-4">
                                No data available
                            </p>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
