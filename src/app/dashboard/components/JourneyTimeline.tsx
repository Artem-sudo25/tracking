'use client'

import { useEffect, useState } from 'react'
import { getJourney, type JourneyTouchpoint } from '@/app/actions/journey'
import { LoaderCircle, Flag } from 'lucide-react'
import { format } from 'date-fns'

interface JourneyTimelineProps {
    clientId: string
    sessionId: string
    conversionLabel: string
    convertedAt: string
}

// Full visitor journey from the touchpoints table: first ad click → returns →
// conversion. Lazy-loads when the parent row is expanded.
export function JourneyTimeline({ clientId, sessionId, conversionLabel, convertedAt }: JourneyTimelineProps) {
    const [journey, setJourney] = useState<JourneyTouchpoint[] | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        getJourney(clientId, sessionId)
            .then(data => { if (!cancelled) setJourney(data) })
            .catch(() => { if (!cancelled) setFailed(true) })
        return () => { cancelled = true }
    }, [clientId, sessionId])

    if (failed) {
        return <p className="text-xs text-muted-foreground">Could not load journey.</p>
    }

    if (journey === null) {
        return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="h-3 w-3 animate-spin" /> Loading journey…
            </div>
        )
    }

    if (journey.length === 0) {
        return <p className="text-xs text-muted-foreground">No journey recorded for this session.</p>
    }

    return (
        <div className="space-y-0">
            {journey.map((touch, i) => (
                <div key={touch.touchpoint_number ?? i} className="flex gap-3">
                    {/* Marker + connector line */}
                    <div className="flex flex-col items-center">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                            {touch.touchpoint_number ?? i + 1}
                        </div>
                        <div className="w-px flex-1 bg-border" />
                    </div>

                    <div className="pb-4 text-sm min-w-0">
                        <p className="font-medium">
                            {touch.source || 'direct'} / {touch.medium || '(none)'}
                            {touch.gclid && <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">gclid</span>}
                            {touch.fbclid && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">fbclid</span>}
                        </p>
                        {touch.campaign && (
                            <p className="text-xs text-muted-foreground">Campaign: {touch.campaign}</p>
                        )}
                        {touch.landing_page && (
                            <p className="truncate text-xs text-muted-foreground" title={touch.landing_page}>{touch.landing_page}</p>
                        )}
                        {touch.timestamp && (
                            <p className="text-xs text-muted-foreground">{format(new Date(touch.timestamp), 'MMM d, y · HH:mm')}</p>
                        )}
                    </div>
                </div>
            ))}

            {/* Conversion node */}
            <div className="flex gap-3">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100">
                    <Flag className="h-3 w-3 text-green-700" />
                </div>
                <div className="text-sm">
                    <p className="font-medium text-green-700">{conversionLabel}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(convertedAt), 'MMM d, y · HH:mm')}</p>
                </div>
            </div>
        </div>
    )
}
