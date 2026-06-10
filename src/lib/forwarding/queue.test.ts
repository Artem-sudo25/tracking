import { describe, it, expect } from 'vitest'
import { RETRY_DELAYS_SECONDS, MAX_ATTEMPTS, nextRetryDelay } from './queue'

describe('retry backoff schedule', () => {
    it('matches the documented 1m → 5m → 30m → 2h → 12h → 24h schedule', () => {
        expect(RETRY_DELAYS_SECONDS).toEqual([60, 300, 1800, 7200, 43200, 86400])
        expect(MAX_ATTEMPTS).toBe(6)
    })

    it('returns the right delay per attempt and clamps past the end', () => {
        expect(nextRetryDelay(0)).toBe(60)
        expect(nextRetryDelay(3)).toBe(7200)
        expect(nextRetryDelay(5)).toBe(86400)
        expect(nextRetryDelay(99)).toBe(86400)
    })
})
