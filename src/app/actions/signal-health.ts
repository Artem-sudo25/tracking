'use server'

import { createClient } from '@supabase/supabase-js'
import type { SignalHealthData, SignalHealthMetric } from '@/types/dashboard'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function getSignalHealth(clientId: string): Promise<SignalHealthData> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  function metric(sent: number, total: number): SignalHealthMetric {
    return { sent, total, rate: total > 0 ? sent / total : 0 }
  }

  const [
    { count: totalLeads },
    { count: fbSent },
    { count: googleSent },
    { count: unmatchedCount },
    { count: totalSessions },
    { count: gaCount },
    { count: fbcCount },
    { count: countryCount },
    { count: queuedRetries },
    { count: deadItems },
  ] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('client_id', clientId).gte('created_at', thirtyDaysAgo),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('sent_to_facebook', true).gte('created_at', thirtyDaysAgo),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('sent_to_google', true).gte('created_at', thirtyDaysAgo),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('match_type', 'none').gte('created_at', thirtyDaysAgo),
    supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('client_id', clientId).gte('created_at', thirtyDaysAgo),
    supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('client_id', clientId).not('ga_client_id', 'is', null).gte('created_at', thirtyDaysAgo),
    supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('client_id', clientId).not('fbc', 'is', null).gte('created_at', thirtyDaysAgo),
    supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('client_id', clientId).not('country', 'is', null).gte('created_at', thirtyDaysAgo),
    supabase.from('forwarding_queue').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('status', 'pending'),
    supabase.from('forwarding_queue').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('status', 'dead'),
  ])

  return {
    fbLeads: metric(fbSent ?? 0, totalLeads ?? 0),
    googleLeads: metric(googleSent ?? 0, totalLeads ?? 0),
    matchRate: metric((totalLeads ?? 0) - (unmatchedCount ?? 0), totalLeads ?? 0),
    gaClientId: metric(gaCount ?? 0, totalSessions ?? 0),
    fbc: metric(fbcCount ?? 0, totalSessions ?? 0),
    country: metric(countryCount ?? 0, totalSessions ?? 0),
    queuedRetries: queuedRetries ?? 0,
    deadItems: deadItems ?? 0,
  }
}
