'use client'

import { useDeferredValue, useState, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Filter, Search } from 'lucide-react'
import { updateLeadStatus } from '@/app/actions/dashboard'
import { PipelineMetrics } from './PipelineMetrics'
import type { LeadStatus, PipelineMetricsData } from '@/types/dashboard'

interface Lead {
    id: string
    name?: string | null
    email?: string | null
    phone?: string | null
    source?: string | null
    status?: LeadStatus | null
    created_at: string
    deal_value?: number | null
    attribution_data?: Record<string, unknown> | null
}

interface LeadsManagerProps {
    initialLeads: Lead[]
    metrics: PipelineMetricsData
}

type StatusFeedback = {
    tone: 'success' | 'error'
    text: string
}

const normalizeStatus = (status?: LeadStatus | null): LeadStatus => status || 'new'

const createDraftStatuses = (leads: Lead[]): Record<string, LeadStatus> =>
    Object.fromEntries(leads.map((lead) => [lead.id, normalizeStatus(lead.status)]))

export function LeadsManager({ initialLeads, metrics }: LeadsManagerProps) {
    const router = useRouter()
    const [leads, setLeads] = useState(initialLeads)
    const [draftStatuses, setDraftStatuses] = useState<Record<string, LeadStatus>>(() => createDraftStatuses(initialLeads))
    const [statusFeedback, setStatusFeedback] = useState<Record<string, StatusFeedback>>({})
    const [searchQuery, setSearchQuery] = useState('')
    const deferredSearchQuery = useDeferredValue(searchQuery)
    const [statusFilter, setStatusFilter] = useState('all')
    const [isWonModalOpen, setIsWonModalOpen] = useState(false)
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
    const [dealValue, setDealValue] = useState('')
    const [savingLeadId, setSavingLeadId] = useState<string | null>(null)
    const [isRefreshing, startRefreshTransition] = useTransition()

    const filteredLeads = leads.filter((lead) => {
        const query = deferredSearchQuery.toLowerCase()
        const matchesSearch =
            (lead.name?.toLowerCase() || '').includes(query) ||
            (lead.email?.toLowerCase() || '').includes(query)
        const matchesStatus = statusFilter === 'all' || normalizeStatus(lead.status) === statusFilter

        return matchesSearch && matchesStatus
    })

    const handleDraftStatusChange = (leadId: string, nextStatus: LeadStatus) => {
        setDraftStatuses((prev) => ({ ...prev, [leadId]: nextStatus }))
        setStatusFeedback((prev) => {
            const next = { ...prev }
            delete next[leadId]
            return next
        })
    }

    const persistStatus = async (leadId: string, nextStatus: LeadStatus, nextDealValue?: number) => {
        setSavingLeadId(leadId)

        const result = await updateLeadStatus(leadId, nextStatus, nextDealValue)

        if (!result.success) {
            setStatusFeedback((prev) => ({
                ...prev,
                [leadId]: {
                    tone: 'error',
                    text: result.error || 'Could not save the new status.',
                },
            }))
            setSavingLeadId(null)
            return
        }

        setLeads((prev) =>
            prev.map((lead) =>
                lead.id === leadId
                    ? {
                        ...lead,
                        status: nextStatus,
                        deal_value: nextDealValue !== undefined ? nextDealValue : lead.deal_value,
                    }
                    : lead
            )
        )

        setDraftStatuses((prev) => ({ ...prev, [leadId]: nextStatus }))
        setStatusFeedback((prev) => ({
            ...prev,
            [leadId]: {
                tone: 'success',
                text: 'Saved',
            },
        }))
        setSavingLeadId(null)

        startRefreshTransition(() => {
            router.refresh()
        })
    }

    const handleSaveClick = (leadId: string) => {
        const lead = leads.find((item) => item.id === leadId)
        if (!lead) {
            return
        }

        const nextStatus = draftStatuses[leadId] || normalizeStatus(lead.status)

        if (nextStatus === 'won') {
            setSelectedLeadId(leadId)
            setDealValue(lead.deal_value ? String(lead.deal_value) : '')
            setIsWonModalOpen(true)
            return
        }

        void persistStatus(leadId, nextStatus)
    }

    const confirmWonStatus = async () => {
        if (!selectedLeadId) {
            return
        }

        const value = parseFloat(dealValue) || 0
        await persistStatus(selectedLeadId, 'won', value)

        setIsWonModalOpen(false)
        setSelectedLeadId(null)
    }

    const getStatusColor = (status?: LeadStatus | null) => {
        switch (status) {
            case 'new':
                return 'bg-orange-100 text-orange-800'
            case 'contacted':
                return 'bg-blue-100 text-blue-800'
            case 'qualified':
                return 'bg-purple-100 text-purple-800'
            case 'won':
                return 'bg-green-100 text-green-800'
            case 'lost':
                return 'bg-gray-100 text-gray-800'
            default:
                return 'bg-gray-100 text-gray-800'
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-4">
                <Link href="/dashboard">
                    <Button variant="ghost" size="sm" className="gap-2 pl-0">
                        <ArrowLeft className="h-4 w-4" />
                        Back to Dashboard
                    </Button>
                </Link>
                <h1 className="text-2xl font-bold tracking-tight">Lead Pipeline</h1>
            </div>

            <PipelineMetrics data={metrics} />

            <Card>
                <CardHeader>
                    <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
                        <div>
                            <CardTitle>Lead Management</CardTitle>
                            <CardDescription>Manage and track your leads pipeline</CardDescription>
                        </div>
                        <div className="flex w-full items-center gap-2 md:w-auto">
                            <div className="relative flex-1 md:w-64">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search leads..."
                                    className="h-9 pl-8"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                />
                            </div>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="h-9 w-[130px]">
                                    <Filter className="mr-2 h-4 w-4" />
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Status</SelectItem>
                                    <SelectItem value="new">New</SelectItem>
                                    <SelectItem value="contacted">Contacted</SelectItem>
                                    <SelectItem value="qualified">Qualified</SelectItem>
                                    <SelectItem value="won">Won</SelectItem>
                                    <SelectItem value="lost">Lost</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Source</TableHead>
                                    <TableHead>Value</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredLeads.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                            No leads found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredLeads.map((lead) => {
                                        const currentStatus = normalizeStatus(lead.status)
                                        const draftStatus = draftStatuses[lead.id] || currentStatus
                                        const isDirty = draftStatus !== currentStatus
                                        const isSaving = savingLeadId === lead.id
                                        const feedback = statusFeedback[lead.id]

                                        return (
                                            <TableRow key={lead.id}>
                                                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                                    {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{lead.name || 'Unknown'}</div>
                                                    <div className="text-xs text-muted-foreground">{lead.email}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <Select
                                                                value={draftStatus}
                                                                onValueChange={(value) => handleDraftStatusChange(lead.id, value as LeadStatus)}
                                                            >
                                                                <SelectTrigger className={`h-7 w-[120px] border-0 text-xs ${getStatusColor(draftStatus)}`}>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="new">New</SelectItem>
                                                                    <SelectItem value="contacted">Contacted</SelectItem>
                                                                    <SelectItem value="qualified">Qualified</SelectItem>
                                                                    <SelectItem value="won">Won</SelectItem>
                                                                    <SelectItem value="lost">Lost</SelectItem>
                                                                </SelectContent>
                                                            </Select>

                                                            <Button
                                                                size="sm"
                                                                variant={isDirty ? 'default' : 'outline'}
                                                                onClick={() => handleSaveClick(lead.id)}
                                                                disabled={!isDirty || isSaving}
                                                            >
                                                                {isSaving ? 'Saving...' : 'Save'}
                                                            </Button>
                                                        </div>

                                                        {feedback?.tone === 'error' && (
                                                            <p className="text-xs text-red-600">{feedback.text}</p>
                                                        )}
                                                        {isDirty && !feedback && (
                                                            <p className="text-xs text-amber-600">Unsaved change</p>
                                                        )}
                                                        {feedback?.tone === 'success' && !isDirty && (
                                                            <p className="text-xs text-green-600">{feedback.text}</p>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm">{lead.source}</TableCell>
                                                <TableCell className="text-sm">
                                                    {lead.deal_value ? (
                                                        <span className="font-medium text-green-600">
                                                            {new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(lead.deal_value)}
                                                        </span>
                                                    ) : '-'}
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {isRefreshing && (
                        <p className="mt-3 text-xs text-muted-foreground">
                            Refreshing pipeline metrics...
                        </p>
                    )}
                </CardContent>
            </Card>

            <Dialog
                open={isWonModalOpen}
                onOpenChange={(open) => {
                    setIsWonModalOpen(open)
                    if (!open) {
                        setSelectedLeadId(null)
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Mark Lead as Won</DialogTitle>
                        <DialogDescription>
                            Enter the final deal value before saving this lead as won.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <label className="mb-2 block text-sm font-medium">Deal Value (CZK)</label>
                        <Input
                            type="number"
                            placeholder="0.00"
                            value={dealValue}
                            onChange={(event) => setDealValue(event.target.value)}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsWonModalOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={confirmWonStatus} disabled={savingLeadId === selectedLeadId}>
                            {savingLeadId === selectedLeadId ? 'Saving...' : 'Save'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
