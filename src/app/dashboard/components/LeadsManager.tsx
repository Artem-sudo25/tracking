'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { Search, Filter, ArrowLeft } from 'lucide-react'
import { updateLeadStatus } from '@/app/actions/dashboard'
import { PipelineMetrics } from './PipelineMetrics'

interface Lead {
    id: string
    lead_id?: string
    name?: string
    email?: string
    phone?: string
    source?: string
    status?: string
    created_at: string
    deal_value?: number
    attribution_data?: any
}

interface LeadsManagerProps {
    initialLeads: Lead[]
    metrics: any
}

export function LeadsManager({ initialLeads, metrics }: LeadsManagerProps) {
    const [leads, setLeads] = useState(initialLeads)
    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [sourceFilter, setSourceFilter] = useState('all') // Simplified for now

    // Modal state for 'Won' status
    const [isWonModalOpen, setIsWonModalOpen] = useState(false)
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
    const [dealValue, setDealValue] = useState('')
    const [isUpdating, setIsUpdating] = useState(false)

    // Derived filters
    const filteredLeads = leads.filter(lead => {
        const matchesSearch = (lead.name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (lead.email?.toLowerCase() || '').includes(searchQuery.toLowerCase())
        const matchesStatus = statusFilter === 'all' || lead.status === statusFilter
        return matchesSearch && matchesStatus
    })

    const handleStatusChange = async (leadId: string, newStatus: string) => {
        if (newStatus === 'won') {
            setSelectedLeadId(leadId)
            setDealValue('')
            setIsWonModalOpen(true)
            return
        }

        // Optimistic update
        setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l))

        await updateLeadStatus(leadId, newStatus)
    }

    const confirmWonStatus = async () => {
        if (!selectedLeadId) return

        setIsUpdating(true)
        const value = parseFloat(dealValue) || 0

        // Optimistic update
        setLeads(prev => prev.map(l => l.id === selectedLeadId ? { ...l, status: 'won', deal_value: value } : l))

        await updateLeadStatus(selectedLeadId, 'won', value)

        setIsUpdating(false)
        setIsWonModalOpen(false)
        setSelectedLeadId(null)
    }

    const getStatusColor = (status?: string) => {
        switch (status) {
            case 'new': return 'bg-orange-100 text-orange-800'
            case 'contacted': return 'bg-blue-100 text-blue-800'
            case 'qualified': return 'bg-purple-100 text-purple-800'
            case 'won': return 'bg-green-100 text-green-800'
            case 'lost': return 'bg-gray-100 text-gray-800'
            default: return 'bg-gray-100 text-gray-800'
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-4">
                <Link href="/dashboard">
                    <Button variant="ghost" size="sm" className="pl-0 gap-2">
                        <ArrowLeft className="h-4 w-4" />
                        Back to Dashboard
                    </Button>
                </Link>
                <h1 className="text-2xl font-bold tracking-tight">Lead Pipeline</h1>
            </div>

            <PipelineMetrics data={metrics} />

            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <div>
                            <CardTitle>Lead Management</CardTitle>
                            <CardDescription>Manage and track your leads pipeline</CardDescription>
                        </div>
                        <div className="flex items-center gap-2 w-full md:w-auto">
                            <div className="relative flex-1 md:w-64">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search leads..."
                                    className="pl-8 h-9"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-[130px] h-9">
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
                                        <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                                            No leads found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredLeads.map((lead) => (
                                        <TableRow key={lead.id}>
                                            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                                                {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                                            </TableCell>
                                            <TableCell>
                                                <div className="font-medium">{lead.name || 'Unknown'}</div>
                                                <div className="text-xs text-muted-foreground">{lead.email}</div>
                                            </TableCell>
                                            <TableCell>
                                                <Select
                                                    value={lead.status || 'new'}
                                                    onValueChange={(val) => handleStatusChange(lead.id, val)}
                                                >
                                                    <SelectTrigger className={`h-7 w-[110px] text-xs border-0 ${getStatusColor(lead.status)}`}>
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
                                            </TableCell>
                                            <TableCell className="text-sm">{lead.source}</TableCell>
                                            <TableCell className="text-sm">
                                                {lead.deal_value ? (
                                                    <span className="text-green-600 font-medium">
                                                        {new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(lead.deal_value)}
                                                    </span>
                                                ) : '-'}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={isWonModalOpen} onOpenChange={setIsWonModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Mark Lead as Won</DialogTitle>
                        <DialogDescription>
                            Congratulations! Please enter the final deal value for this lead.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <label className="text-sm font-medium mb-2 block">Deal Value (CZK)</label>
                        <Input
                            type="number"
                            placeholder="0.00"
                            value={dealValue}
                            onChange={(e) => setDealValue(e.target.value)}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsWonModalOpen(false)}>Cancel</Button>
                        <Button onClick={confirmWonStatus} disabled={isUpdating}>
                            {isUpdating ? 'Saving...' : 'Confirm'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
