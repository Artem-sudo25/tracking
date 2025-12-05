'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Mail, Phone, MessageSquare, Globe, Monitor, MapPin } from 'lucide-react'

interface Lead {
    lead_id: string
    name: string
    email: string
    phone?: string
    form_type: string
    lead_value: number
    status?: string
    created_at: string
    message?: string
    custom_fields?: any
    attribution_data?: {
        first_touch?: {
            source: string
            medium: string
            campaign?: string
            term?: string
            content?: string
            referrer?: string
            landing?: string
            timestamp?: string
        }
        last_touch?: {
            source: string
            medium: string
            campaign?: string
            timestamp?: string
        }
        device?: {
            type?: string
            browser?: string
            os?: string
            country?: string
        }
    }
}

interface RecentLeadsProps {
    leads: Lead[]
}

const PAGE_SIZE = 10

export function RecentLeads({ leads }: RecentLeadsProps) {
    const [currentPage, setCurrentPage] = useState(1)
    const [expandedLeads, setExpandedLeads] = useState<Set<string>>(new Set())
    const [isCardExpanded, setIsCardExpanded] = useState(true)

    const totalPages = Math.ceil(leads.length / PAGE_SIZE)
    const startIndex = (currentPage - 1) * PAGE_SIZE
    const endIndex = startIndex + PAGE_SIZE
    const currentLeads = leads.slice(startIndex, endIndex)

    const toggleExpand = (leadId: string) => {
        setExpandedLeads(prev => {
            const newSet = new Set(prev)
            if (newSet.has(leadId)) {
                newSet.delete(leadId)
            } else {
                newSet.add(leadId)
            }
            return newSet
        })
    }

    // ... existing helpers ...

    // Copy helper functions here to avoid removing them
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
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setIsCardExpanded(!isCardExpanded)}>
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <CardTitle>Recent Leads</CardTitle>
                            {isCardExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </div>
                        {isCardExpanded && (
                            <CardDescription>
                                Showing {startIndex + 1}-{Math.min(endIndex, leads.length)} of {leads.length} leads
                            </CardDescription>
                        )}
                    </div>
                    {isCardExpanded && totalPages > 1 && (
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
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
            {isCardExpanded && (
                <CardContent>
                    <div className="space-y-4">
                        {currentLeads.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">
                                No leads yet
                            </p>
                        ) : (
                            currentLeads.map((lead) => {
                                const isExpanded = expandedLeads.has(lead.lead_id)

                                return (
                                    <div
                                        key={lead.lead_id}
                                        className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                                        data-lead-id={lead.lead_id}
                                        onClick={() => console.log('Clicked lead:', lead.lead_id)}
                                    >
                                        {/* Collapsed View */}
                                        <div className="flex items-start justify-between">
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
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-medium">
                                                    {new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(lead.lead_value)}
                                                </p>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => toggleExpand(lead.lead_id)}
                                                    className="h-8 w-8 p-0"
                                                >
                                                    {isExpanded ? (
                                                        <ChevronUp className="h-4 w-4" />
                                                    ) : (
                                                        <ChevronDown className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Expanded View */}
                                        {isExpanded && (
                                            <div className="mt-4 pt-4 border-t space-y-3 animate-in slide-in-from-top-2">
                                                {/* Contact Info */}
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="flex items-start gap-2">
                                                        <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                                                        <div>
                                                            <p className="text-xs text-muted-foreground">Email</p>
                                                            <p className="text-sm">{lead.email}</p>
                                                        </div>
                                                    </div>
                                                    {lead.phone && (
                                                        <div className="flex items-start gap-2">
                                                            <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                                                            <div>
                                                                <p className="text-xs text-muted-foreground">Phone</p>
                                                                <p className="text-sm">{lead.phone}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Message */}
                                                {lead.message && (
                                                    <div className="flex items-start gap-2">
                                                        <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />
                                                        <div className="flex-1">
                                                            <p className="text-xs text-muted-foreground">Message</p>
                                                            <p className="text-sm">{lead.message}</p>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Attribution */}
                                                {lead.attribution_data?.first_touch && (
                                                    <div className="space-y-2">
                                                        <p className="text-xs font-medium text-muted-foreground">Attribution</p>
                                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                                            <div>
                                                                <span className="text-muted-foreground">First Touch: </span>
                                                                <span className="font-medium">
                                                                    {lead.attribution_data.first_touch.source} / {lead.attribution_data.first_touch.medium}
                                                                </span>
                                                                {lead.attribution_data.first_touch.campaign && (
                                                                    <span className="text-muted-foreground"> ({lead.attribution_data.first_touch.campaign})</span>
                                                                )}
                                                            </div>
                                                            {lead.attribution_data.last_touch && (
                                                                <div>
                                                                    <span className="text-muted-foreground">Last Touch: </span>
                                                                    <span className="font-medium">
                                                                        {lead.attribution_data.last_touch.source} / {lead.attribution_data.last_touch.medium}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Device Info */}
                                                {lead.attribution_data?.device && (
                                                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                                        {lead.attribution_data.device.type && (
                                                            <div className="flex items-center gap-1">
                                                                <Monitor className="h-3 w-3" />
                                                                <span>{lead.attribution_data.device.type}</span>
                                                            </div>
                                                        )}
                                                        {lead.attribution_data.device.browser && (
                                                            <div className="flex items-center gap-1">
                                                                <Globe className="h-3 w-3" />
                                                                <span>{lead.attribution_data.device.browser}</span>
                                                            </div>
                                                        )}
                                                        {lead.attribution_data.device.country && (
                                                            <div className="flex items-center gap-1">
                                                                <MapPin className="h-3 w-3" />
                                                                <span>{lead.attribution_data.device.country}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Custom Fields */}
                                                {lead.custom_fields && Object.keys(lead.custom_fields).length > 0 && (
                                                    <div>
                                                        <p className="text-xs font-medium text-muted-foreground mb-1">Custom Fields</p>
                                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                                            {Object.entries(lead.custom_fields).map(([key, value]) => (
                                                                <div key={key}>
                                                                    <span className="text-muted-foreground capitalize">{key}: </span>
                                                                    <span className="font-medium">{String(value)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )
                            })
                        )}
                    </div>
                </CardContent>
            )}
        </Card>
    )
}
