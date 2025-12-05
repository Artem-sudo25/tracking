import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function POST(request: Request) {
    const supabase = await createClient()

    // Sign out
    const { error } = await supabase.auth.signOut()

    if (error) {
        console.error('Error signing out:', error)
        return new Response('Error signing out', { status: 500 })
    }

    revalidatePath('/', 'layout')
    redirect('/login')
}
