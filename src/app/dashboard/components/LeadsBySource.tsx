'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface LeadsBySourceProps {
    data: any[]
}

export function LeadsBySource({ data }: LeadsBySourceProps) {
    const getCPLColor = (cpl: number) => {
        if (cpl === 0) return 'text-muted-foreground'
        if (cpl <= 200) return 'text-green-600 font-semibold'  // Excellent
        if (cpl <= 400) return 'text-yellow-600'  // Moderate
        return 'text-red-600'  // Expensive
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Leads by Source</CardTitle>
                <CardDescription>Lead generation performance by channel</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Source / Medium</TableHead>
                                <TableHead className="text-right">Leads</TableHead>
                                <TableHead className="text-right">Spend</TableHead>
                                <TableHead className="text-right">CPL</TableHead>
                                <TableHead className="text-right">Total Value</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                                        No lead data available
                                    </TableCell>
                                </TableRow>
                            ) : (
                                data.map((item, index) => (
                                    <TableRow key={`${item.source}-${item.medium}-${index}`}>
                                        <TableCell className="font-medium">
                                            {item.source} / {item.medium}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {item.count}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {item.spend > 0
                                                ? new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(item.spend)
                                                : '-'
                                            }
                                        </TableCell>
                                        <TableCell className={cn("text-right font-medium", getCPLColor(item.cpl || 0))}>
                                            {item.cpl > 0
                                                ? new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(item.cpl)
                                                : item.spend > 0 ? '0 Kč' : '-'
                                            }
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(item.value || 0)}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {data.length > 0 && data.some(d => d.spend > 0) && (
                    <div className="mt-4 space-y-2 text-sm">
                        <p className="font-semibold">CPL (Cost Per Lead) Benchmarks:</p>
                        <div className="flex flex-wrap gap-4">
                            <div className="flex items-center gap-2">
                                <div className="h-3 w-3 rounded-full bg-green-600"></div>
                                <span>≤ 200 Kč (Excellent)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="h-3 w-3 rounded-full bg-yellow-600"></div>
                                <span>200-400 Kč (Moderate)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="h-3 w-3 rounded-full bg-red-600"></div>
                                <span>&gt; 400 Kč (Expensive)</span>
                            </div>
                        </div>
                        <p className="text-muted-foreground mt-2">
                            💡 <strong>Tip:</strong> For B2B services, focus on lead quality over quantity.
                            A 400 Kč lead that converts to a 500,000 Kč customer is excellent ROI!
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
