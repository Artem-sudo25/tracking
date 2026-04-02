'use client'

import { useRef, useState, useTransition } from 'react'
import { getLeadListPage } from '@/app/actions/dashboard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { format, formatDistanceToNow } from 'date-fns'
import {
    ChevronDown,
    ChevronUp,
    LoaderCircle,
    Mail,
    MessageSquare,
    Globe,
    Monitor,
    MapPin,
    Phone,
} from 'lucide-react'
import type { LeadListItem, LeadListScope } from '@/types/dashboard'

interface RecentLeadsProps {
    clientId: string
    leads: LeadListItem[]
    initialTotal: number
    startDate: string
    endDate: string
}

const PAGE_SIZE = 20

export function RecentLeads({
    clientId,
    leads,
    initialTotal,
    startDate,
    endDate,
}: RecentLeadsProps) {
    const [scope, setScope] = useState<LeadListScope>('period')
    const [leadPages, setLeadPages] = useState<Record<LeadListScope, { leads: LeadListItem[]; total: number }>>({
        period: { leads, total: initialTotal },
        all_time: { leads: [], total: 0 },
    })
    const [expandedLeads, setExpandedLeads] = useState<Set<string>>(new Set())
    const [isCardExpanded, setIsCardExpanded] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [isPending, startTransition] = useTransition()
    const latestRequestId = useRef(0)
    const visibleLeads = leadPages[scope].leads
    const totalLeads = leadPages[scope].total
    const hasMore = visibleLeads.length < totalLeads
    const scopeLabel = scope === 'all_time' ? 'all time' : 'selected period'
    const periodLabel = `${format(new Date(startDate), 'LLL dd, y')} - ${format(new Date(endDate), 'LLL dd, y')}`

    const toggleExpand = (leadId: string) => {
        setExpandedLeads((prev) => {
            const next = new Set(prev)
            if (next.has(leadId)) {
                next.delete(leadId)
            } else {
                next.add(leadId)
            }
            return next
        })
    }

    const fetchLeadPage = (nextScope: LeadListScope, offset: number) => {
        const requestId = ++latestRequestId.current

        startTransition(() => {
            void (async () => {
                try {
                    const page = await getLeadListPage(
                        clientId,
                        nextScope,
                        startDate,
                        endDate,
                        PAGE_SIZE,
                        offset
                    )

                    if (requestId !== latestRequestId.current) {
                        return
                    }

                    setLeadPages((prev) => ({
                        ...prev,
                        [nextScope]: {
                            leads: offset === 0 ? page.leads : [...prev[nextScope].leads, ...page.leads],
                            total: page.total,
                        },
                    }))

                    if (offset === 0) {
                        setExpandedLeads(new Set())
                    }

                    setLoadError(null)
                } catch (error) {
                    console.error('Failed to load leads:', error)
                    setLoadError('Could not load more leads.')
                }
            })()
        })
    }

    const handleScopeChange = (nextScope: LeadListScope) => {
        if (nextScope === scope) {
            return
        }

        setScope(nextScope)

        if (nextScope === 'period') {
            fetchLeadPage('period', 0)
            return
        }

        if (leadPages.all_time.leads.length > 0) {
            setExpandedLeads(new Set())
            setLoadError(null)
            return
        }

        fetchLeadPage(nextScope, 0)
    }

    const handleLoadMore = () => {
        if (!hasMore || isPending) {
            return
        }

        fetchLeadPage(scope, visibleLeads.length)
    }

    const getStatusColor = (status?: string | null) => {
        switch (status) {
            case 'new':
                return 'bg-orange-100 text-orange-800 border-orange-200'
            case 'contacted':
                return 'bg-blue-100 text-blue-800 border-blue-200'
            case 'qualified':
                return 'bg-purple-100 text-purple-800 border-purple-200'
            case 'won':
                return 'bg-green-100 text-green-800 border-green-200'
            case 'lost':
                return 'bg-gray-100 text-gray-800 border-gray-200'
            default:
                return 'bg-orange-100 text-orange-800 border-orange-200'
        }
    }

    const getFormTypeLabel = (formType?: string | null) => {
        const labels: Record<string, string> = {
            contact: 'Contact',
            demo: 'Demo',
            'free-trial': 'Free Trial',
            quote: 'Quote',
        }

        if (!formType) {
            return 'General Form'
        }

        return labels[formType] || formType
    }

    return (
        <Card>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setIsCardExpanded(!isCardExpanded)}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <CardTitle>Leads</CardTitle>
                            {isCardExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {isPending && <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />}
                        </div>
                        {isCardExpanded && (
                            <CardDescription>
                                Showing {visibleLeads.length} of {totalLeads} leads in {scopeLabel}
                                {scope === 'period' ? ` (${periodLabel})` : ''}
                            </CardDescription>
                        )}
                    </div>

                    {isCardExpanded && (
                        <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                            <Button
                                variant={scope === 'period' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => handleScopeChange('period')}
                                disabled={isPending}
                            >
                                Selected Period
                            </Button>
                            <Button
                                variant={scope === 'all_time' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => handleScopeChange('all_time')}
                                disabled={isPending}
                            >
                                All Time
                            </Button>
                        </div>
                    )}
                </div>
            </CardHeader>

            {isCardExpanded && (
                <CardContent>
                    <div className="space-y-4">
                        {visibleLeads.length === 0 ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">
                                No leads in this scope yet
                            </p>
                        ) : (
                            visibleLeads.map((lead) => {
                                const isExpanded = expandedLeads.has(lead.id)

                                return (
                                    <div
                                        key={lead.id}
                                        className="rounded-lg border p-4 transition-colors hover:bg-muted/50"
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-medium leading-none">
                                                        {lead.name || 'Unknown'}
                                                    </p>
                                                    <Badge variant="outline" className={getStatusColor(lead.status)}>
                                                        {lead.status || 'new'}
                                                    </Badge>
                                                </div>
                                                <p className="truncate text-sm text-muted-foreground">
                                                    {lead.email || 'No email'}
                                                </p>
                                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                    <span>{getFormTypeLabel(lead.form_type)}</span>
                                                    <span>•</span>
                                                    <span>{formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}</span>
                                                    {lead.attribution_data?.first_touch?.source && (
                                                        <>
                                                            <span>•</span>
                                                            <span>{lead.attribution_data.first_touch.source}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-medium">
                                                    {new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(lead.lead_value || 0)}
                                                </p>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(event) => {
                                                        event.stopPropagation()
                                                        toggleExpand(lead.id)
                                                    }}
                                                    className="h-8 w-8 p-0"
                                                    aria-label={isExpanded ? 'Collapse lead details' : 'Expand lead details'}
                                                >
                                                    {isExpanded ? (
                                                        <ChevronUp className="h-4 w-4" />
                                                    ) : (
                                                        <ChevronDown className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>

                                        {isExpanded && (
                                            <div className="mt-4 space-y-3 border-t pt-4 animate-in slide-in-from-top-2">
                                                <div className="grid gap-3 md:grid-cols-2">
                                                    <div className="flex items-start gap-2">
                                                        <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                                        <div>
                                                            <p className="text-xs text-muted-foreground">Email</p>
                                                            <p className="text-sm">{lead.email || 'No email'}</p>
                                                        </div>
                                                    </div>
                                                    {lead.phone && (
                                                        <div className="flex items-start gap-2">
                                                            <Phone className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                                            <div>
                                                                <p className="text-xs text-muted-foreground">Phone</p>
                                                                <p className="text-sm">{lead.phone}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {lead.message && (
                                                    <div className="flex items-start gap-2">
                                                        <MessageSquare className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                                        <div className="flex-1">
                                                            <p className="text-xs text-muted-foreground">Message</p>
                                                            <p className="text-sm">{lead.message}</p>
                                                        </div>
                                                    </div>
                                                )}

                                                {lead.attribution_data?.first_touch && (
                                                    <div className="space-y-2">
                                                        <p className="text-xs font-medium text-muted-foreground">Attribution</p>
                                                        <div className="grid gap-2 text-xs md:grid-cols-2">
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

                                                {lead.attribution_data?.device && (
                                                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
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

                                                {lead.custom_fields && Object.keys(lead.custom_fields).length > 0 && (
                                                    <div>
                                                        <p className="mb-1 text-xs font-medium text-muted-foreground">Custom Fields</p>
                                                        <div className="grid gap-2 text-xs md:grid-cols-2">
                                                            {Object.entries(lead.custom_fields).map(([key, value]) => (
                                                                <div key={key}>
                                                                    <span className="capitalize text-muted-foreground">{key}: </span>
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

                        {loadError && (
                            <p className="text-sm text-red-600">{loadError}</p>
                        )}

                        {hasMore && (
                            <div className="flex justify-center pt-2">
                                <Button variant="outline" onClick={handleLoadMore} disabled={isPending}>
                                    {isPending ? 'Loading...' : `Load ${Math.min(PAGE_SIZE, totalLeads - visibleLeads.length)} More`}
                                </Button>
                            </div>
                        )}
                    </div>
                </CardContent>
            )}
        </Card>
    )
}
