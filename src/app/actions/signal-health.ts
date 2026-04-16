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
    return { sent, total, rate: total > 0 ? sent / total : 1 }
  }

  // --- Leads ---
  const { count: totalLeads } = await supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).gte('created_at', thirtyDaysAgo)

  const { count: fbSent } = await supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('sent_to_facebook', true).gte('created_at', thirtyDaysAgo)

  const { count: googleSent } = await supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('sent_to_google', true).gte('created_at', thirtyDaysAgo)

  const { count: unmatchedCount } = await supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('match_type', 'none').gte('created_at', thirtyDaysAgo)

  const total = totalLeads ?? 0

  // --- Sessions ---
  const { count: totalSessions } = await supabase
    .from('sessions').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).gte('created_at', thirtyDaysAgo)

  const { count: gaCount } = await supabase
    .from('sessions').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).not('ga_client_id', 'is', null).gte('created_at', thirtyDaysAgo)

  const { count: fbcCount } = await supabase
    .from('sessions').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).not('fbc', 'is', null).gte('created_at', thirtyDaysAgo)

  const { count: countryCount } = await supabase
    .from('sessions').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).not('country', 'is', null).gte('created_at', thirtyDaysAgo)

  const sessions = totalSessions ?? 0

  // --- Queue ---
  const { count: queuedRetries } = await supabase
    .from('forwarding_queue').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('status', 'pending')

  const { count: deadItems } = await supabase
    .from('forwarding_queue').select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('status', 'dead')

  return {
    fbLeads: metric(fbSent ?? 0, total),
    googleLeads: metric(googleSent ?? 0, total),
    matchRate: metric(total - (unmatchedCount ?? 0), total),
    gaClientId: metric(gaCount ?? 0, sessions),
    fbc: metric(fbcCount ?? 0, sessions),
    country: metric(countryCount ?? 0, sessions),
    queuedRetries: queuedRetries ?? 0,
    deadItems: deadItems ?? 0,
  }
}
