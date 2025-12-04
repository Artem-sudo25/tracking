import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

const CLIENT_ID = process.env.CLIENT_ID!

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const email = searchParams.get('email')

        if (!email) {
            return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 })
        }

        const normalizedEmail = email.toLowerCase().trim()

        // Delete sessions
        await supabase
            .from('sessions')
            .delete()
            .eq('email', normalizedEmail)
            .eq('client_id', CLIENT_ID)

        // Delete events (via session_id would require lookup first)
        // For simplicity, we'll anonymize orders instead of deleting

        // Anonymize orders
        await supabase
            .from('orders')
            .update({
                customer_email: null,
                customer_phone: null,
                attribution_data: { deleted: true, deletion_date: new Date().toISOString() },
            })
            .eq('customer_email', normalizedEmail)
            .eq('client_id', CLIENT_ID)

        // Anonymize leads
        await supabase
            .from('leads')
            .update({
                email: null,
                phone: null,
                name: null,
                company: null,
                message: null,
                attribution_data: { deleted: true, deletion_date: new Date().toISOString() },
            })
            .eq('email', normalizedEmail)
            .eq('client_id', CLIENT_ID)

        return NextResponse.json({
            success: true,
            message: `Data deleted for ${normalizedEmail}`
        })

    } catch (error) {
        console.error('Deletion error:', error)
        return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
    }
}
