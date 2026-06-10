'use server'

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export interface JourneyTouchpoint {
  touchpoint_number: number
  source: string | null
  medium: string | null
  campaign: string | null
  landing_page: string | null
  timestamp: string
  gclid: string | null
  fbclid: string | null
}

// Full visitor journey for one session — every marketing touch recorded in
// the touchpoints table, in order. Powers the Journey timeline on leads/orders.
export async function getJourney(clientId: string, sessionId: string): Promise<JourneyTouchpoint[]> {
  const { data, error } = await supabase
    .from('touchpoints')
    .select('touchpoint_number, source, medium, campaign, landing_page, timestamp, gclid, fbclid')
    .eq('client_id', clientId)
    .eq('session_id', sessionId)
    .order('touchpoint_number', { ascending: true })
    .limit(50)

  if (error) {
    console.error('[Journey] Failed to load touchpoints:', error)
    return []
  }

  return data || []
}
