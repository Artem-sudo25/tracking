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
            return NextResponse.json({ success: false, error: 'No session' }, { status: 400 })
        }

        const updateData: any = {}

        if (body.email) {
            updateData.email = body.email.toLowerCase().trim()
        }

        if (body.phone) {
            updateData.phone = body.phone.replace(/\D/g, '')
        }

        if (body.customer_id) {
            updateData.external_id = body.customer_id
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ success: false, error: 'No data provided' }, { status: 400 })
        }

        const { error } = await supabase
            .from('sessions')
            .update(updateData)
            .eq('session_id', sessionId)
            .eq('client_id', CLIENT_ID)

        if (error) throw error

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('Identify error:', error)
        return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
    }
}
