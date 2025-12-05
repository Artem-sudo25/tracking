'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Mark leads as seen by updating the last_leads_view timestamp
 */
export async function markLeadsAsSeen(clientId: string) {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
        return { success: false, error: 'Not authenticated' }
    }

    // Upsert the last_leads_view timestamp
    const { error } = await supabase
        .from('user_dashboard_activity')
        .upsert({
            user_id: user.id,
            client_id: clientId,
            last_leads_view: new Date().toISOString(),
        }, {
            onConflict: 'user_id,client_id'
        })

    if (error) {
        console.error('Error marking leads as seen:', error)
        return { success: false, error: error.message }
    }

    return { success: true }
}

/**
 * Mark purchases as seen by updating the last_purchases_view timestamp
 */
export async function markPurchasesAsSeen(clientId: string) {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
        return { success: false, error: 'Not authenticated' }
    }

    // Upsert the last_purchases_view timestamp
    const { error } = await supabase
        .from('user_dashboard_activity')
        .upsert({
            user_id: user.id,
            client_id: clientId,
            last_purchases_view: new Date().toISOString(),
        }, {
            onConflict: 'user_id,client_id'
        })

    if (error) {
        console.error('Error marking purchases as seen:', error)
        return { success: false, error: error.message }
    }

    return { success: true }
}

/**
 * Get the last time user viewed leads
 */
export async function getLastLeadsView(clientId: string): Promise<string | null> {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
        .from('user_dashboard_activity')
        .select('last_leads_view')
        .eq('user_id', user.id)
        .eq('client_id', clientId)
        .single()

    return data?.last_leads_view || null
}
