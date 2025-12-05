import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, TrendingUp, DollarSign, Target, Calendar, Bell } from 'lucide-react'

interface LeadsStatsCardsProps {
    totalLeads: number
    conversionRate: number
    avgLeadValue: number
    topSource: string
    leadsInPeriod: number
    timeLabel: string
    newLeadsCount: number
}

export function LeadsStatsCards({
    totalLeads,
    conversionRate,
    avgLeadValue,
    topSource,
    leadsInPeriod,
    timeLabel,
    newLeadsCount
}: LeadsStatsCardsProps) {
    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{totalLeads}</div>
                    <p className="text-xs text-muted-foreground">
                        {newLeadsCount} new leads
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{(conversionRate * 100).toFixed(1)}%</div>
                    <p className="text-xs text-muted-foreground">
                        Leads → Purchases
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg Lead Value</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">
                        {new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(avgLeadValue)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Per lead
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Leads {timeLabel}</CardTitle>
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{leadsInPeriod}</div>
                    <p className="text-xs text-muted-foreground">
                        In selected period
                    </p>
                </CardContent>
            </Card>

            {newLeadsCount > 0 && (
                <Card className="border-orange-200 bg-orange-50/50">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-orange-900">New Leads</CardTitle>
                        <Bell className="h-4 w-4 text-orange-600 animate-pulse" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-900">{newLeadsCount}</div>
                        <p className="text-xs text-orange-700">
                            Require attention
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
