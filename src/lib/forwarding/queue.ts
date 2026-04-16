// src/lib/forwarding/queue.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// Exponential backoff delays in seconds: 1m, 5m, 30m, 2h, 12h, 24h
export const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 43200, 86400]
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length

export function nextRetryDelay(attempts: number): number {
  return RETRY_DELAYS_SECONDS[Math.min(attempts, RETRY_DELAYS_SECONDS.length - 1)]
}

export async function enqueueFailedForwarding({
  clientId,
  eventType,
  eventId,
  platform,
  payload,
  error,
}: {
  clientId: string
  eventType: 'lead' | 'order'
  eventId: string
  platform: 'facebook' | 'google'
  payload: Record<string, any>
  error?: string
}): Promise<void> {
  const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_SECONDS[0] * 1000).toISOString()

  const { error: dbError } = await supabase.from('forwarding_queue').insert({
    client_id: clientId,
    event_type: eventType,
    event_id: eventId,
    platform,
    payload,
    status: 'pending',
    attempts: 0,
    next_retry_at: nextRetryAt,
    last_error: error ?? null,
  })

  if (dbError) {
    console.error('[Queue] Failed to enqueue forwarding:', dbError)
  }
}
