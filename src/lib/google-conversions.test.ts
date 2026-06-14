import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import {
    pickClickId,
    buildGoogleConversionsCsv,
    formatGoogleTime,
    hashEmail,
    hashPhone,
    normalizePhoneE164,
    type RawConversion,
} from './google-conversions'

const sha256Hex = (v: string) => createHash('sha256').update(v).digest('hex')

const base: RawConversion = {
    externalId: 'o-1',
    value: 1500,
    currency: 'CZK',
    createdAt: '2026-06-13T08:52:00Z',
    sessionId: 'sess-1',
    clickIds: { gclid: 'Cj0test' },
}

describe('pickClickId', () => {
    it('prefers gclid over gbraid and wbraid', () => {
        expect(pickClickId({ gclid: 'g', gbraid: 'b', wbraid: 'w' })).toEqual({ column: 'gclid', value: 'g' })
    })
    it('falls back to gbraid when no gclid (iOS/app click)', () => {
        expect(pickClickId({ gbraid: 'b', wbraid: 'w' })).toEqual({ column: 'gbraid', value: 'b' })
    })
    it('falls back to wbraid when only wbraid', () => {
        expect(pickClickId({ wbraid: 'w' })).toEqual({ column: 'wbraid', value: 'w' })
    })
    it('returns null when no identifier is present', () => {
        expect(pickClickId({ gclid: null, gbraid: null, wbraid: undefined })).toBeNull()
    })
})

describe('formatGoogleTime', () => {
    it('formats to Google Ads UTC offset format', () => {
        expect(formatGoogleTime('2026-06-13T08:52:03Z')).toBe('2026-06-13 08:52:03+00:00')
    })
})

describe('buildGoogleConversionsCsv', () => {
    it('emits the Google Ads header row with gbraid/wbraid + enhanced columns', () => {
        const { csv } = buildGoogleConversionsCsv([base], 'HaloTrack Purchase')
        expect(csv.split('\n')[0]).toBe(
            'Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID,Email,Phone Number'
        )
    })

    it('puts gclid in column 1 and leaves gbraid/wbraid empty', () => {
        const { csv, rowCount } = buildGoogleConversionsCsv([base], 'HaloTrack Purchase')
        const row = csv.split('\n')[1].split(',')
        expect(rowCount).toBe(1)
        expect(row[0]).toBe('Cj0test')
        expect(row[1]).toBe('') // GBRAID
        expect(row[2]).toBe('') // WBRAID
        expect(row[3]).toBe('HaloTrack Purchase')
        expect(row[5]).toBe('1500')
        expect(row[6]).toBe('CZK')
        expect(row[7]).toBe('o-1')
    })

    it('routes a gbraid-only conversion into the GBRAID column', () => {
        const rec = { ...base, externalId: 'o-2', clickIds: { gbraid: '0AAAgbraid' } }
        const row = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase').csv.split('\n')[1].split(',')
        expect(row[0]).toBe('') // gclid empty
        expect(row[1]).toBe('0AAAgbraid')
    })

    it('skips conversions with no click id at all', () => {
        const rec = { ...base, externalId: 'o-3', clickIds: {} }
        const { rowCount, skippedCount } = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase')
        expect(rowCount).toBe(0)
        expect(skippedCount).toBe(1)
    })

    it('skips conversions whose session withdrew consent (denied)', () => {
        const denied = new Set(['sess-denied'])
        const rec = { ...base, externalId: 'o-4', sessionId: 'sess-denied' }
        const { rowCount, skippedCount } = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase', denied)
        expect(rowCount).toBe(0)
        expect(skippedCount).toBe(1)
    })

    it('includes granted + unknown (only denied is filtered)', () => {
        const denied = new Set(['sess-denied'])
        const granted = { ...base, externalId: 'o-5', sessionId: 'sess-granted' }
        const unknown = { ...base, externalId: 'o-6', sessionId: 'sess-unknown' }
        const { rowCount } = buildGoogleConversionsCsv([granted, unknown], 'HaloTrack Purchase', denied)
        expect(rowCount).toBe(2)
    })

    it('handles a null value as an empty value cell', () => {
        const rec = { ...base, externalId: 'o-7', value: null }
        const row = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase').csv.split('\n')[1].split(',')
        expect(row[5]).toBe('')
    })

    it('appends hashed email + phone in the enhanced-conversion columns', () => {
        const rec = { ...base, externalId: 'o-8', email: 'Buyer@Example.com ', phone: '777 123 456' }
        const row = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase').csv.split('\n')[1].split(',')
        expect(row[8]).toBe(sha256Hex('buyer@example.com'))      // trimmed + lowercased
        expect(row[9]).toBe(sha256Hex('+420777123456'))          // E.164
    })

    it('leaves enhanced columns empty when no email/phone present', () => {
        const row = buildGoogleConversionsCsv([base], 'HaloTrack Purchase').csv.split('\n')[1].split(',')
        expect(row[8]).toBe('') // Email
        expect(row[9]).toBe('') // Phone Number
    })

    it('includes a row with email but NO click id (cross-device gap)', () => {
        const rec = { ...base, externalId: 'o-9', clickIds: {}, email: 'x@y.com' }
        const { csv, rowCount, skippedCount } = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase')
        const row = csv.split('\n')[1].split(',')
        expect(rowCount).toBe(1)
        expect(skippedCount).toBe(0)
        expect(row[0]).toBe('')                         // no gclid
        expect(row[8]).toBe(sha256Hex('x@y.com'))       // matched on email
    })

    it('still skips a row with no click id AND no email/phone', () => {
        const rec = { ...base, externalId: 'o-10', clickIds: {}, email: null, phone: null }
        const { rowCount, skippedCount } = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase')
        expect(rowCount).toBe(0)
        expect(skippedCount).toBe(1)
    })

    it('never emits PII for a denied session even with email/phone', () => {
        const denied = new Set(['sess-denied'])
        const rec = { ...base, externalId: 'o-11', sessionId: 'sess-denied', email: 'x@y.com', phone: '777123456' }
        const { rowCount, skippedCount } = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase', denied)
        expect(rowCount).toBe(0)
        expect(skippedCount).toBe(1)
    })
})

describe('enhanced-conversion hashing', () => {
    it('hashEmail trims and lowercases before hashing', () => {
        expect(hashEmail('  Foo@Bar.COM ')).toBe(sha256Hex('foo@bar.com'))
    })
    it('hashEmail returns empty for whitespace-only input', () => {
        expect(hashEmail('   ')).toBe('')
    })
    it('normalizePhoneE164 adds country code to a bare 9-digit CZ mobile', () => {
        expect(normalizePhoneE164('777 123 456')).toBe('+420777123456')
    })
    it('normalizePhoneE164 strips a 00 international prefix', () => {
        expect(normalizePhoneE164('00420777123456')).toBe('+420777123456')
    })
    it('normalizePhoneE164 keeps an already-+prefixed number', () => {
        expect(normalizePhoneE164('+420777123456')).toBe('+420777123456')
    })
    it('hashPhone returns empty when there are no digits', () => {
        expect(hashPhone('')).toBe('')
    })
})
