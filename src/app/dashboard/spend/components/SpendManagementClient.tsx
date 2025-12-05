'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SpendEntryForm } from './SpendEntryForm'
import { CSVUpload } from './CSVUpload'
import { SpendHistoryTable } from './SpendHistoryTable'
import type { AdSpendData } from '@/app/actions/spend'

interface SpendManagementClientProps {
    clientId: string
    initialData: AdSpendData[]
}

export function SpendManagementClient({ clientId, initialData }: SpendManagementClientProps) {
    const [spendData, setSpendData] = useState<AdSpendData[]>(initialData)

    const handleDataUpdate = (newData: AdSpendData[]) => {
        setSpendData(newData)
    }

    const totalSpend = spendData.reduce((sum, entry) => sum + entry.spend, 0)

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Ad Spend Management</h2>
                <p className="text-muted-foreground">Track your marketing spend across all channels</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Import Spend Data</CardTitle>
                    <CardDescription>Add spend entries manually or upload a CSV file</CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="manual" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                            <TabsTrigger value="csv">CSV Upload</TabsTrigger>
                        </TabsList>
                        <TabsContent value="manual" className="mt-6">
                            <SpendEntryForm clientId={clientId} onSuccess={handleDataUpdate} />
                        </TabsContent>
                        <TabsContent value="csv" className="mt-6">
                            <CSVUpload clientId={clientId} onSuccess={handleDataUpdate} />
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Spend History</CardTitle>
                            <CardDescription>Last 30 days of ad spend</CardDescription>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-muted-foreground">Total Spend</p>
                            <p className="text-2xl font-bold">
                                {new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(totalSpend)}
                            </p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <SpendHistoryTable data={spendData} onUpdate={handleDataUpdate} />
                </CardContent>
            </Card>
        </div>
    )
}
