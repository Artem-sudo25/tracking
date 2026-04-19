'use client'

import { useState } from 'react'
import { startOfDay, endOfDay, subDays } from 'date-fns'
import { Download, AlertCircle, CheckCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DateRangePicker } from './DateRangePicker'
import { DateRange } from '@/types'
import {
    exportMetaConversions,
    exportGoogleConversions,
    exportMetaLeads,
    exportGoogleLeads,
} from '@/app/actions/export'
import type { ExportResult } from '@/app/actions/export'

type ClientType = 'ecommerce' | 'leads' | 'bookings' | 'combined'

interface ExportConversionsProps {
    clientId: string
    clientType?: ClientType
}

type ExportStatus = {
    state: 'idle' | 'loading' | 'done' | 'error'
    rowCount?: number
    skippedCount?: number
    message?: string
}

function downloadCsv(csv: string, filename: string): void {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
}

function useExportHandler(
    action: () => Promise<ExportResult>,
    noun: string // 'orders' | 'leads' | 'bookings'
) {
    const [status, setStatus] = useState<ExportStatus>({ state: 'idle' })

    async function run() {
        setStatus({ state: 'loading' })
        try {
            const result = await action()
            if (result.rowCount === 0) {
                setStatus({
                    state: 'done',
                    rowCount: 0,
                    skippedCount: result.skippedCount,
                    message: result.skippedCount > 0
                        ? `No exportable rows — ${result.skippedCount} ${noun} skipped (no match signal).`
                        : `No ${noun} found in this date range.`,
                })
                return
            }
            downloadCsv(result.csv, result.filename)
            setStatus({ state: 'done', rowCount: result.rowCount, skippedCount: result.skippedCount })
        } catch (err) {
            setStatus({ state: 'error', message: String(err) })
        }
    }

    return { status, run, reset: () => setStatus({ state: 'idle' }) }
}

// ─── Single platform panel ────────────────────────────────────────────────────

interface PlatformPanelProps {
    platform: 'meta' | 'google'
    noun: string               // 'orders' | 'leads' | 'bookings'
    bullets: string[]
    uploadUrl: string
    uploadLabel: string
    buttonLabel: string
    onExport: (failedOnly: boolean) => Promise<ExportResult>
}

function PlatformPanel({ platform, noun, bullets, uploadUrl, uploadLabel, buttonLabel, onExport }: PlatformPanelProps) {
    const [failedOnly, setFailedOnly] = useState(false)
    const { status, run, reset } = useExportHandler(() => onExport(failedOnly), noun)

    const color = platform === 'meta' ? '#0082FB' : '#4285F4'
    const platformLabel = platform === 'meta' ? 'Meta' : 'Google Ads'

    return (
        <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color }}>{platformLabel}</span>
                <span className="text-xs text-muted-foreground">Offline Conversions</span>
            </div>

            <ul className="text-xs text-muted-foreground space-y-0.5">
                {bullets.map(b => <li key={b}>• {b}</li>)}
            </ul>

            <p className="text-xs text-muted-foreground">
                Upload at:{' '}
                <a href={uploadUrl} target="_blank" rel="noreferrer" className="underline">
                    {uploadLabel}
                </a>
            </p>

            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                    type="checkbox"
                    checked={failedOnly}
                    onChange={e => { setFailedOnly(e.target.checked); reset() }}
                    className="rounded"
                />
                Failed forwards only
            </label>

            <Button onClick={run} disabled={status.state === 'loading'} className="w-full" variant="outline">
                <Download className="mr-2 h-4 w-4" />
                {status.state === 'loading' ? 'Generating…' : buttonLabel}
            </Button>

            <ExportFeedback status={status} />
        </div>
    )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExportConversions({ clientId, clientType = 'combined' }: ExportConversionsProps) {
    const isBookings = clientType === 'bookings'
    const showOrders = clientType === 'ecommerce' || clientType === 'combined'
    const showLeads  = clientType === 'leads' || clientType === 'bookings' || clientType === 'combined'

    const leadsLabel  = isBookings ? 'Bookings' : 'Leads'
    const metaEvent   = isBookings ? 'Schedule' : 'Lead'   // Meta event taxonomy
    const googleConv  = isBookings ? 'Booking'  : 'Lead'   // Google conversion name
    const noun        = isBookings ? 'bookings' : 'leads'

    const [dateRange, setDateRange] = useState<DateRange>({
        from: subDays(new Date(), 30),
        to: new Date(),
    })

    const startDate = startOfDay(dateRange.from ?? subDays(new Date(), 30)).toISOString()
    const endDate   = endOfDay(dateRange.to ?? new Date()).toISOString()

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base font-semibold">Manual Conversion Export</CardTitle>
                <p className="text-sm text-muted-foreground">
                    Export conversions as CSV for manual upload to Meta or Google Ads.
                    Use this to recover events that were not forwarded automatically.
                </p>
            </CardHeader>
            <CardContent className="space-y-6">

                <div className="space-y-1">
                    <label className="text-sm font-medium">Date range</label>
                    <DateRangePicker date={dateRange} onDateChange={setDateRange} />
                </div>

                {/* Orders section */}
                {showOrders && (
                    <div className="space-y-3">
                        {clientType === 'combined' && (
                            <p className="text-sm font-medium text-muted-foreground">Orders</p>
                        )}
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <PlatformPanel
                                platform="meta"
                                noun="orders"
                                bullets={[
                                    'Email + phone hashed with SHA-256',
                                    'fbc / fbp passed as-is (not hashed)',
                                    'Rows without email or fbc are skipped',
                                ]}
                                uploadUrl="https://business.facebook.com/events_manager"
                                uploadLabel="Events Manager → Offline Events"
                                buttonLabel="Download Orders for Meta"
                                onExport={(failedOnly) =>
                                    exportMetaConversions(clientId, startDate, endDate, failedOnly)
                                }
                            />
                            <PlatformPanel
                                platform="google"
                                noun="orders"
                                bullets={[
                                    'Matched by Google Click ID (gclid)',
                                    'Rows without gclid are skipped',
                                    'No PII in file — safe to handle',
                                ]}
                                uploadUrl="https://ads.google.com/aw/conversions"
                                uploadLabel="Google Ads → Goals → Offline conversions"
                                buttonLabel="Download Orders for Google"
                                onExport={(failedOnly) =>
                                    exportGoogleConversions(clientId, startDate, endDate, failedOnly)
                                }
                            />
                        </div>
                    </div>
                )}

                {/* Divider for combined view */}
                {clientType === 'combined' && showOrders && showLeads && (
                    <div className="border-t" />
                )}

                {/* Leads / Bookings section */}
                {showLeads && (
                    <div className="space-y-3">
                        {clientType === 'combined' && (
                            <p className="text-sm font-medium text-muted-foreground">{leadsLabel}</p>
                        )}
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <PlatformPanel
                                platform="meta"
                                noun={noun}
                                bullets={[
                                    'Email + phone hashed with SHA-256',
                                    'fbc / fbp passed as-is (not hashed)',
                                    `Event name: "${metaEvent}"`,
                                    `Rows without email or fbc are skipped`,
                                ]}
                                uploadUrl="https://business.facebook.com/events_manager"
                                uploadLabel="Events Manager → Offline Events"
                                buttonLabel={`Download ${leadsLabel} for Meta`}
                                onExport={(failedOnly) =>
                                    exportMetaLeads(clientId, startDate, endDate, failedOnly, metaEvent)
                                }
                            />
                            <PlatformPanel
                                platform="google"
                                noun={noun}
                                bullets={[
                                    'Matched by Google Click ID (gclid)',
                                    'Rows without gclid are skipped',
                                    'No PII in file — safe to handle',
                                ]}
                                uploadUrl="https://ads.google.com/aw/conversions"
                                uploadLabel="Google Ads → Goals → Offline conversions"
                                buttonLabel={`Download ${leadsLabel} for Google`}
                                onExport={(failedOnly) =>
                                    exportGoogleLeads(clientId, startDate, endDate, failedOnly, googleConv)
                                }
                            />
                        </div>
                    </div>
                )}

            </CardContent>
        </Card>
    )
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

function ExportFeedback({ status }: { status: ExportStatus }) {
    if (status.state === 'idle') return null

    if (status.state === 'loading') {
        return <p className="text-xs text-muted-foreground">Fetching data…</p>
    }

    if (status.state === 'error') {
        return (
            <div className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{status.message}</span>
            </div>
        )
    }

    if (status.state === 'done') {
        if (status.rowCount === 0) {
            return (
                <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{status.message}</span>
                </div>
            )
        }
        return (
            <div className="flex items-start gap-1.5 text-xs text-green-600">
                <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                    {status.rowCount} {status.rowCount === 1 ? 'row' : 'rows'} exported
                    {status.skippedCount ? ` · ${status.skippedCount} skipped (no match signal)` : ''}
                </span>
            </div>
        )
    }

    return null
}
