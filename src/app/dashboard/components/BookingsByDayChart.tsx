'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from 'recharts'
import type { BookingsByDayItem } from '@/app/actions/bookings'

interface BookingsByDayChartProps {
    data: BookingsByDayItem[]
}

export function BookingsByDayChart({ data }: BookingsByDayChartProps) {
    if (!data || data.length === 0) return null

    const maxCount = Math.max(...data.map(d => d.count), 1)

    return (
        <Card>
            <CardHeader>
                <CardTitle>Bookings by Day of Week</CardTitle>
                <CardDescription>Which days drive the most bookings in the selected period</CardDescription>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                        <XAxis
                            dataKey="day"
                            tick={{ fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            allowDecimals={false}
                            tick={{ fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip
                            formatter={(value: number) => [value, 'Bookings']}
                            cursor={{ fill: 'hsl(var(--muted))' }}
                        />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                            {data.map((entry) => (
                                <Cell
                                    key={entry.day}
                                    // Strongest colour for the busiest day, muted for quiet days
                                    fill={entry.count === maxCount
                                        ? 'hsl(var(--primary))'
                                        : 'hsl(var(--primary) / 0.35)'
                                    }
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    )
}
