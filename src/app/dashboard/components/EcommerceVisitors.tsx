'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { EcommerceVisitorData } from '@/app/actions/ecommerce-visitors'

export function EcommerceVisitors({ data }: { data: EcommerceVisitorData }) {
    return (
        <div className="space-y-4">
            {/* Stat cards */}
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                <StatCard label="Sessions" value={data.totalSessions.toLocaleString('cs-CZ')} />
                <StatCard label="Page Views" value={data.totalPageViews.toLocaleString('cs-CZ')} />
                <StatCard label="Pages / Session" value={data.pagesPerSession.toFixed(2)} />
                <StatCard label="Conversion Rate" value={`${data.conversionRate.toFixed(2)}%`} />
            </div>

            {/* Sessions by day chart */}
            <Card>
                <CardHeader>
                    <CardTitle>Sessions over time</CardTitle>
                </CardHeader>
                <CardContent className="pl-2">
                    <div className="h-[200px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.sessionsByDay}>
                                <XAxis
                                    dataKey="date"
                                    stroke="#888888"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis
                                    stroke="#888888"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip
                                    contentStyle={{ background: '#333', border: 'none', borderRadius: '4px', color: '#fff' }}
                                    itemStyle={{ color: '#fff' }}
                                    formatter={(value: number) => [value, 'Sessions']}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="sessions"
                                    stroke="#60a5fa"
                                    strokeWidth={2}
                                    activeDot={{ r: 8 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Sources + Landing pages + Devices */}
            <div className="grid gap-4 md:grid-cols-3">
                {/* Top sources */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Top Sources</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                                    <th className="text-left px-4 py-2">Source / Medium</th>
                                    <th className="text-right px-4 py-2">Sessions</th>
                                    <th className="text-right px-4 py-2">%</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.topSources.map((row, i) => (
                                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                        <td className="px-4 py-2 truncate max-w-[140px]">
                                            <span className="font-medium">{row.source}</span>
                                            <span className="text-muted-foreground"> / {row.medium}</span>
                                        </td>
                                        <td className="px-4 py-2 text-right">{row.sessions}</td>
                                        <td className="px-4 py-2 text-right text-muted-foreground">{row.pct.toFixed(1)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>

                {/* Top landing pages */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Top Landing Pages</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                                    <th className="text-left px-4 py-2">Page</th>
                                    <th className="text-right px-4 py-2">Sessions</th>
                                    <th className="text-right px-4 py-2">%</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.topLandingPages.map((row, i) => (
                                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                        <td className="px-4 py-2 truncate max-w-[140px]" title={row.page}>{row.page}</td>
                                        <td className="px-4 py-2 text-right">{row.sessions}</td>
                                        <td className="px-4 py-2 text-right text-muted-foreground">{row.pct.toFixed(1)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>

                {/* Device breakdown */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Devices</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                                    <th className="text-left px-4 py-2">Type</th>
                                    <th className="text-right px-4 py-2">Sessions</th>
                                    <th className="text-right px-4 py-2">%</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.deviceBreakdown.map((row, i) => (
                                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                        <td className="px-4 py-2 capitalize">{row.type}</td>
                                        <td className="px-4 py-2 text-right">{row.sessions}</td>
                                        <td className="px-4 py-2 text-right text-muted-foreground">{row.pct.toFixed(1)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <Card>
            <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold mt-1">{value}</p>
            </CardContent>
        </Card>
    )
}
