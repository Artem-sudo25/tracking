'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface RevenueBySourceProps {
    data: any[] // In a real app, define proper types
}

export function RevenueBySource({ data }: RevenueBySourceProps) {
    return (
        <Card className="col-span-4">
            <CardHeader>
                <CardTitle>Revenue by Source</CardTitle>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="first-touch" className="space-y-4">
                    <TabsList>
                        <TabsTrigger value="first-touch">First Touch</TabsTrigger>
                        <TabsTrigger value="last-touch">Last Touch</TabsTrigger>
                    </TabsList>
                    <TabsContent value="first-touch" className="space-y-4">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Source / Medium</TableHead>
                                    <TableHead className="text-right">Orders</TableHead>
                                    <TableHead className="text-right">Revenue</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.map((item) => (
                                    <TableRow key={item.source}>
                                        <TableCell className="font-medium">{item.source} / {item.medium}</TableCell>
                                        <TableCell className="text-right">{item.orders}</TableCell>
                                        <TableCell className="text-right">
                                            {new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(item.revenue)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TabsContent>
                    <TabsContent value="last-touch" className="space-y-4">
                        <div className="text-sm text-muted-foreground">Last touch data would go here...</div>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    )
}
