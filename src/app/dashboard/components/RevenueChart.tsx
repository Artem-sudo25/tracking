'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface RevenueChartProps {
    data: any[]
}

export function RevenueChart({ data }: RevenueChartProps) {
    return (
        <Card className="col-span-4">
            <CardHeader>
                <CardTitle>Revenue over time</CardTitle>
            </CardHeader>
            <CardContent className="pl-2">
                <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data}>
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
                                tickFormatter={(value) => `${value}`}
                            />
                            <Tooltip
                                contentStyle={{ background: '#333', border: 'none', borderRadius: '4px', color: '#fff' }}
                                itemStyle={{ color: '#fff' }}
                                formatter={(value: number) => [`CZK ${value}`, 'Revenue']}
                            />
                            <Line
                                type="monotone"
                                dataKey="revenue"
                                stroke="#adfa1d"
                                strokeWidth={2}
                                activeDot={{ r: 8 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    )
}
