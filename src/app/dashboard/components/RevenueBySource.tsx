'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface RevenueBySourceProps {
    data: any[] // In a real app, define proper types
}

export function RevenueBySource({ data }: RevenueBySourceProps) {
    const getROASColor = (roas: number) => {
        if (roas >= 2.0) return 'text-green-600 font-semibold'
        if (roas >= 1.0) return 'text-yellow-600'
        if (roas > 0) return 'text-red-600'
        return 'text-muted-foreground'
    }

    const getProfitColor = (profit: number) => {
        if (profit > 0) return 'text-green-600'
        if (profit < 0) return 'text-red-600'
        return 'text-muted-foreground'
    }

    return (
        <Card className="col-span-4">
            <CardHeader>
                <CardTitle>Channel Performance & ROI</CardTitle>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="first-touch" className="space-y-4">
                    <TabsList>
                        <TabsTrigger value="first-touch">First Touch</TabsTrigger>
                        <TabsTrigger value="last-touch">Last Touch</TabsTrigger>
                    </TabsList>
                    <TabsContent value="first-touch" className="space-y-4">
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Source / Medium</TableHead>
                                        <TableHead className="text-right">Orders</TableHead>
                                        <TableHead className="text-right">Spend</TableHead>
                                        <TableHead className="text-right">CPA</TableHead>
                                        <TableHead className="text-right">Revenue</TableHead>
                                        <TableHead className="text-right">ROAS</TableHead>
                                        <TableHead className="text-right">Profit</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center text-muted-foreground">
                                                No data available
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        data.map((item, index) => (
                                            <TableRow key={`${item.source}-${item.medium}-${index}`}>
                                                <TableCell className="font-medium">
                                                    {item.source} / {item.medium}
                                                </TableCell>
                                                <TableCell className="text-right">{item.orders || 0}</TableCell>
                                                <TableCell className="text-right">
                                                    {item.spend > 0
                                                        ? new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(item.spend)
                                                        : '-'
                                                    }
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {item.cpa > 0
                                                        ? new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(item.cpa)
                                                        : '-'
                                                    }
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(item.revenue || 0)}
                                                </TableCell>
                                                <TableCell className={cn("text-right", getROASColor(item.roas || 0))}>
                                                    {item.roas > 0
                                                        ? `${item.roas.toFixed(2)}x`
                                                        : item.spend > 0 ? '0.00x' : '∞'
                                                    }
                                                </TableCell>
                                                <TableCell className={cn("text-right font-medium", getProfitColor(item.profit || 0))}>
                                                    {item.spend > 0
                                                        ? new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(item.profit || 0)
                                                        : new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(item.revenue || 0)
                                                    }
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {data.length > 0 && (
                            <div className="space-y-2 text-sm">
                                <p className="font-semibold">Legend:</p>
                                <div className="flex flex-wrap gap-4">
                                    <div className="flex items-center gap-2">
                                        <div className="h-3 w-3 rounded-full bg-green-600"></div>
                                        <span>ROAS ≥ 2.0x (Excellent)</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="h-3 w-3 rounded-full bg-yellow-600"></div>
                                        <span>ROAS 1.0-2.0x (Moderate)</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="h-3 w-3 rounded-full bg-red-600"></div>
                                        <span>ROAS &lt; 1.0x (Losing Money)</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </TabsContent>
                    <TabsContent value="last-touch" className="space-y-4">
                        <div className="text-sm text-muted-foreground">Last touch attribution coming soon...</div>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    )
}
