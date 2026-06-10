import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { sha256, normalizePhoneDigits, normalizePhoneE164, fbEventsUrl, FB_GRAPH_VERSION } from './shared'

const nodeSha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('sha256', () => {
    it('produces hex-encoded SHA-256', async () => {
        expect(await sha256('test@example.com')).toBe(nodeSha('test@example.com'))
    })
})

describe('normalizePhoneDigits (Meta format: digits with country code)', () => {
    it('prepends the calling code to a 9-digit national number', () => {
        expect(normalizePhoneDigits('777 123 456', 'CZ')).toBe('420777123456')
        expect(normalizePhoneDigits('777123456', 'SK')).toBe('421777123456')
    })

    it('passes international formats through unchanged', () => {
        expect(normalizePhoneDigits('+420 777-123-456', 'CZ')).toBe('420777123456')
        expect(normalizePhoneDigits('00420777123456', 'CZ')).toBe('420777123456')
        expect(normalizePhoneDigits('420777123456', 'CZ')).toBe('420777123456')
    })

    it('leaves national numbers alone when the country is unknown', () => {
        expect(normalizePhoneDigits('777123456', null)).toBe('777123456')
        expect(normalizePhoneDigits('777123456', 'DE')).toBe('777123456')
    })
})

describe('normalizePhoneE164 (Google format: +country…)', () => {
    it('produces E.164 from a national number + session country', () => {
        expect(normalizePhoneE164('777 123 456', 'CZ')).toBe('+420777123456')
    })

    it('produces E.164 from already-international input', () => {
        expect(normalizePhoneE164('+420777123456', null)).toBe('+420777123456')
        expect(normalizePhoneE164('00421 777 123 456', null)).toBe('+421777123456')
    })

    it('returns empty string for empty input', () => {
        expect(normalizePhoneE164('', 'CZ')).toBe('')
    })
})

describe('fbEventsUrl', () => {
    it('uses the centralized Graph API version', () => {
        expect(fbEventsUrl('PIXEL', 'TOKEN')).toBe(
            `https://graph.facebook.com/${FB_GRAPH_VERSION}/PIXEL/events?access_token=TOKEN`
        )
    })
})
