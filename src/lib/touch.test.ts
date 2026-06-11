import { describe, it, expect } from 'vitest'
import { isDuplicateTouchpoint } from './touch'

const NOW = new Date('2026-06-11T12:00:00Z').getTime()

const adClick = {
    source: 'google',
    medium: 'cpc',
    campaign: null,
    gclid: 'Cj0KCQjw-test',
    fbclid: null,
    ttclid: null,
    msclkid: null,
    timestamp: '2026-06-11T08:52:00Z',
}

describe('isDuplicateTouchpoint', () => {
    it('first touchpoint of a session is never a duplicate', () => {
        expect(isDuplicateTouchpoint(null, adClick, NOW)).toBe(false)
        expect(isDuplicateTouchpoint(undefined, adClick, NOW)).toBe(false)
    })

    it('same gclid browsing the catalog (URL passthrough) is a duplicate, regardless of elapsed time', () => {
        // 3h+ of browsing on the same decorated gclid — still one ad click
        expect(isDuplicateTouchpoint(adClick, { ...adClick, timestamp: undefined }, NOW)).toBe(true)
    })

    it('a new ad click (different gclid) is a new touchpoint', () => {
        expect(isDuplicateTouchpoint(adClick, { ...adClick, gclid: 'Cj0KCQjw-OTHER' }, NOW)).toBe(false)
    })

    it('click id disappearing (return visit without decoration) is not a duplicate', () => {
        expect(isDuplicateTouchpoint(adClick, { ...adClick, gclid: null }, NOW)).toBe(false)
    })

    it('treats null and undefined as the same absent value', () => {
        const prev = { ...adClick, campaign: null }
        const next = { ...adClick, campaign: undefined }
        expect(isDuplicateTouchpoint(prev, next, NOW)).toBe(true)
    })

    it('identical UTM-only touch within 30 min is a refresh — duplicate', () => {
        const utm = { source: 'newsletter', medium: 'email', campaign: 'june', gclid: null, fbclid: null, ttclid: null, msclkid: null }
        const prev = { ...utm, timestamp: '2026-06-11T11:50:00Z' } // 10 min before NOW
        expect(isDuplicateTouchpoint(prev, utm, NOW)).toBe(true)
    })

    it('identical UTM-only touch after 30 min is a genuine repeat visit — not a duplicate', () => {
        const utm = { source: 'newsletter', medium: 'email', campaign: 'june', gclid: null, fbclid: null, ttclid: null, msclkid: null }
        const prev = { ...utm, timestamp: '2026-06-11T09:00:00Z' } // 3h before NOW
        expect(isDuplicateTouchpoint(prev, utm, NOW)).toBe(false)
    })

    it('different UTM campaign is always a new touchpoint', () => {
        const utm = { source: 'newsletter', medium: 'email', campaign: 'june', gclid: null, fbclid: null, ttclid: null, msclkid: null, timestamp: '2026-06-11T11:59:00Z' }
        expect(isDuplicateTouchpoint(utm, { ...utm, campaign: 'july' }, NOW)).toBe(false)
    })
})
