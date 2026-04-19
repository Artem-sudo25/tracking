'use server'

import { createClient } from '@/lib/supabase/server'

export interface BookingsByDayItem {
    day: string   // 'Mon' | 'Tue' | ... | 'Sun'
    count: number
}

export interface BookingsMetaData {
    byDay: BookingsByDayItem[]
    bookingRate: number    // percentage: bookings / sessions × 100
    sessionsInPeriod: number
    bookingsInPeriod: number
}

// Day-of-week order: Mon → Sun (European business convention)
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0] // JS getDay(): 0=Sun, 1=Mon ... 6=Sat
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export async function getBookingsMetaData(
    clientId: string,
    startDate?: string,
    endDate?: string
): Promise<BookingsMetaData> {
    const supabase = await createClient()

    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const end   = endDate   || new Date().toISOString()

    // Fetch bookings (leads) and sessions in parallel
    const [{ data: leads }, { count: sessionsCount }] = await Promise.all([
        supabase
            .from('leads')
            .select('created_at')
            .eq('client_id', clientId)
            .gte('created_at', start)
            .lte('created_at', end),
        supabase
            .from('sessions')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', clientId)
            .gte('created_at', start)
            .lte('created_at', end),
    ])

    const bookingsInPeriod = leads?.length ?? 0
    const sessionsInPeriod = sessionsCount ?? 0
    const bookingRate = sessionsInPeriod > 0
        ? Number(((bookingsInPeriod / sessionsInPeriod) * 100).toFixed(1))
        : 0

    // Count bookings per day of week
    const dayCounts = new Array(7).fill(0)
    leads?.forEach(l => {
        dayCounts[new Date(l.created_at).getDay()]++
    })

    const byDay: BookingsByDayItem[] = DOW_ORDER.map(i => ({
        day: DAY_LABELS[i],
        count: dayCounts[i],
    }))

    return { byDay, bookingRate, sessionsInPeriod, bookingsInPeriod }
}
