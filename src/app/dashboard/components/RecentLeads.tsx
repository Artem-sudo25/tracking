'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Lead {
    lead_id: string
    name: string
    email: string
    phone?: string
    form_type: string
    lead_value: number
    status?: string
    created_at: string
    attribution_data?: any
}

interface RecentLeadsProps {
    leads: Lead[]
}

const PAGE_SIZE = 10

export function RecentLeads({ leads }: RecentLeadsProps) {
    const [currentPage, setCurrentPage] = useState(1)

    const totalPages = Math.ceil(leads.length / PAGE_SIZE)
    const startIndex = (currentPage - 1) * PAGE_SIZE
    const endIndex = startIndex + PAGE_SIZE
    const currentLeads = leads.slice(startIndex, endIndex)

    const getStatusColor = (status?: string) => {
        switch (status) {
            case 'new':
                return 'bg-orange-100 text-orange-800 border-orange-200'
            case 'contacted':
                return 'bg-blue-100 text-blue-800 border-blue-200'
            case 'converted':
                return 'bg-green-100 text-green-800 border-green-200'
            case 'lost':
                return 'bg-gray-100 text-gray-800 border-gray-200'
            default:
                return 'bg-orange-100 text-orange-800 border-orange-200'
        }
    }

    const getFormTypeLabel = (formType: string) => {
        const labels: Record<string, string> = {
            'contact': 'Contact',
            'demo': 'Demo',
            'free-trial': 'Free Trial',
            'quote': 'Quote'
        }
        return labels[formType] || formType
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Recent Leads</CardTitle>
                        <CardDescription>
                            Showing {startIndex + 1}-{Math.min(endIndex, leads.length)} of {leads.length} leads
                        </CardDescription>
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-sm text-muted-foreground">
                                Page {currentPage} of {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {currentLeads.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">
                            No leads yet
                        </p>
                    ) : (
                        currentLeads.map((lead) => (
                            <div
                                key={lead.lead_id}
                                className="flex items-start justify-between border-b pb-4 last:border-0 last:pb-0"
                            >
                                <div className="space-y-1 flex-1">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-medium leading-none">
                                            {lead.name}
                                        </p>
                                        <Badge variant="outline" className={getStatusColor(lead.status)}>
                                            {lead.status || 'new'}
                                        </Badge>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        {lead.email}
                                    </p>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>{getFormTypeLabel(lead.form_type)}</span>
                                        <span>•</span>
                                        <span>{formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}</span>
                                        {lead.attribution_data?.first_touch && (
                                            <>
                                                <span>•</span>
                                                <span>{lead.attribution_data.first_touch.source}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-medium">
                                        {new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(lead.lead_value)}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
