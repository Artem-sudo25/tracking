'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from 'date-fns'

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

export function RecentLeads({ leads }: RecentLeadsProps) {
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
                <CardTitle>Recent Leads</CardTitle>
                <CardDescription>Latest leads from your website</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {leads.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">
                            No leads yet
                        </p>
                    ) : (
                        leads.map((lead) => (
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
