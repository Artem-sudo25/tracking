import { createClient } from '@/lib/supabase/server'
import { getDashboardData } from '@/app/actions/dashboard'
import { DashboardClient } from './components/DashboardClient'

export default async function DashboardPage() {
    const supabase = await createClient()

    // Get current user's client_id
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return null

    const { data: client } = await supabase
        .from('clients')
        .select('client_id')
        .eq('user_id', user.id)
        .single()

    if (!client) {
        return (
            <div className="p-8 text-center">
                <h2 className="text-2xl font-bold">No client account found</h2>
                <p className="text-muted-foreground">Please contact support to set up your account.</p>
            </div>
        )
    }

    // Fetch initial data for the last 30 days
    const initialData = await getDashboardData(client.client_id)

    return <DashboardClient clientId={client.client_id} initialData={initialData} />
}
