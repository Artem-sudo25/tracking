import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const sessionId = request.cookies.get('_halo')?.value

        if (!sessionId) {
            // If no session, we can't track events (unless we want to track anonymous events, but usually events are tied to sessions)
            // For now, we'll just return success to not break client
            return NextResponse.json({ success: true, ignored: true })
        }

        const { error } = await supabase.from('events').insert({
            client_id: CLIENT_ID,
            session_id: sessionId,
            event_name: body.event_name,
            properties: body.properties,
            page_url: request.headers.get('referer'),
        })

        if (error) throw error

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('Event error:', error)
        return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
    }
}
