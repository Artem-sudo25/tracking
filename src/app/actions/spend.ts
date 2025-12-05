'use server'

import { createClient } from '@/lib/supabase/server'

export interface AdSpendEntry {
    id?: string
    client_id?: string
    date: string
    source: string
    medium: string
    campaign?: string
    spend: number
    currency?: string
}

export interface AdSpendData extends AdSpendEntry {
    id: string
    client_id: string
    created_at: string
    updated_at: string
}

/**
 * Import ad spend entries (manual or CSV)
 */
export async function importAdSpend(
    clientId: string,
    entries: AdSpendEntry[]
): Promise<{ success: boolean; error?: string; inserted?: number }> {
    try {
        const supabase = await createClient()

        // Prepare entries with client_id
        const preparedEntries = entries.map(entry => ({
            client_id: clientId,
            date: entry.date,
            source: entry.source,
            medium: entry.medium,
            campaign: entry.campaign || null,
            spend: entry.spend,
            currency: entry.currency || 'CZK'
        }))

        // Insert with upsert to handle duplicates
        const { data, error } = await supabase
            .from('ad_spend')
            .upsert(preparedEntries, {
                onConflict: 'client_id,date,source,medium,campaign',
                ignoreDuplicates: false
            })
            .select()

        if (error) {
            console.error('Error importing ad spend:', error)
            return { success: false, error: error.message }
        }

        return { success: true, inserted: data?.length || 0 }
    } catch (error) {
        console.error('Error in importAdSpend:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }
    }
}

/**
 * Get ad spend data for a date range
 */
export async function getAdSpend(
    clientId: string,
    startDate?: string,
    endDate?: string
): Promise<AdSpendData[]> {
    try {
        const supabase = await createClient()

        let query = supabase
            .from('ad_spend')
            .select('*')
            .eq('client_id', clientId)
            .order('date', { ascending: false })

        if (startDate) {
            query = query.gte('date', startDate)
        }

        if (endDate) {
            query = query.lte('date', endDate)
        }

        const { data, error } = await query

        if (error) {
            console.error('Error fetching ad spend:', error)
            return []
        }

        return data || []
    } catch (error) {
        console.error('Error in getAdSpend:', error)
        return []
    }
}

/**
 * Get aggregated spend by source/medium
 */
export async function getSpendBySource(
    clientId: string,
    startDate?: string,
    endDate?: string
): Promise<Array<{ source: string; medium: string; total_spend: number }>> {
    try {
        const supabase = await createClient()

        let query = supabase
            .from('ad_spend')
            .select('source, medium, spend')
            .eq('client_id', clientId)

        if (startDate) {
            query = query.gte('date', startDate)
        }

        if (endDate) {
            query = query.lte('date', endDate)
        }

        const { data, error } = await query

        if (error) {
            console.error('Error fetching spend by source:', error)
            return []
        }

        // Aggregate by source/medium
        const aggregated = new Map<string, number>()
        data?.forEach(row => {
            const key = `${row.source}/${row.medium}`
            aggregated.set(key, (aggregated.get(key) || 0) + row.spend)
        })

        return Array.from(aggregated.entries()).map(([key, total_spend]) => {
            const [source, medium] = key.split('/')
            return { source, medium, total_spend }
        })
    } catch (error) {
        console.error('Error in getSpendBySource:', error)
        return []
    }
}

/**
 * Update an ad spend entry
 */
export async function updateAdSpend(
    id: string,
    updates: Partial<AdSpendEntry>
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()

        const { error } = await supabase
            .from('ad_spend')
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)

        if (error) {
            console.error('Error updating ad spend:', error)
            return { success: false, error: error.message }
        }

        return { success: true }
    } catch (error) {
        console.error('Error in updateAdSpend:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }
    }
}

/**
 * Delete an ad spend entry
 */
export async function deleteAdSpend(
    id: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()

        const { error } = await supabase
            .from('ad_spend')
            .delete()
            .eq('id', id)

        if (error) {
            console.error('Error deleting ad spend:', error)
            return { success: false, error: error.message }
        }

        return { success: true }
    } catch (error) {
        console.error('Error in deleteAdSpend:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }
    }
}
