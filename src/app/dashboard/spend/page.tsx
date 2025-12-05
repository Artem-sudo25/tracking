import { createClient } from '@/lib/supabase/server'
import { SpendManagementClient } from './components/SpendManagementClient'
import { getAdSpend } from '@/app/actions/spend'

export default async function SpendPage() {
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

    // Fetch initial spend data (last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const initialSpendData = await getAdSpend(
        client.client_id,
        thirtyDaysAgo.toISOString().split('T')[0],
        new Date().toISOString().split('T')[0]
    )

    return <SpendManagementClient clientId={client.client_id} initialData={initialSpendData} />
}
