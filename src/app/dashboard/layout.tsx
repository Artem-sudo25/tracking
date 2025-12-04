import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            <nav className="border-b bg-white dark:bg-gray-800 px-4 py-3">
                <div className="flex items-center justify-between max-w-7xl mx-auto">
                    <h1 className="text-xl font-bold">HaloTrack</h1>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-500">{user.email}</span>
                        <form action="/auth/signout" method="post">
                            <button className="text-sm font-medium hover:underline">Sign out</button>
                        </form>
                    </div>
                </div>
            </nav>
            <main className="max-w-7xl mx-auto p-4 md:p-8">
                {children}
            </main>
        </div>
    )
}
