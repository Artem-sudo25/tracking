import { createClient } from '@/lib/supabase/server'
import { LeadsManager } from '../components/LeadsManager'
import { getPipelineMetrics } from '@/app/actions/dashboard'

export default async function LeadsPage() {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return <div>Not authenticated</div>
    }

    const { data: client } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.id)
        .single()

    if (!client) {
        return <div>Client not found</div>
    }

    // Fetch initial leads
    const { data: leads } = await supabase
        .from('leads')
        .select('*')
        .eq('client_id', client.client_id)
        .order('created_at', { ascending: false })

    // Fetch metrics
    const metrics = await getPipelineMetrics(client.client_id)

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Lead Pipeline</h1>
            <LeadsManager initialLeads={leads || []} metrics={metrics} />
        </div>
    )
}
