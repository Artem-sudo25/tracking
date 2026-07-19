import { describe, it, expect } from 'vitest'
import {
    pickClickId,
    buildGoogleConversionsCsv,
    formatGoogleTime,
    type RawConversion,
} from './google-conversions'

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
    it('emits the Google Ads header row (click ids + consent)', () => {
        const { csv } = buildGoogleConversionsCsv([base], 'HaloTrack Purchase')
        expect(csv.split('\n')[0]).toBe(
            'Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID,Ad User Data Consent,Ad Personalization Consent'
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

    it('skips conversions with no click id (this action matches on click ids only)', () => {
        const rec = { ...base, externalId: 'o-3', clickIds: {} }
        const { rowCount, skippedCount } = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase')
        expect(rowCount).toBe(0)
        expect(skippedCount).toBe(1)
    })

    it('skips conversions whose session withdrew consent (denied set)', () => {
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

    it('stamps GRANTED in both consent columns for a granted session', () => {
        const rec: RawConversion = { ...base, externalId: 'o-12', consent: 'granted' }
        const row = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase').csv.split('\n')[1].split(',')
        expect(row[8]).toBe('GRANTED') // Ad User Data Consent
        expect(row[9]).toBe('GRANTED') // Ad Personalization Consent
    })

    it('stamps UNSPECIFIED for unknown consent (no over-claim)', () => {
        const rec: RawConversion = { ...base, externalId: 'o-13', consent: 'unknown' }
        const row = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase').csv.split('\n')[1].split(',')
        expect(row[8]).toBe('UNSPECIFIED')
        expect(row[9]).toBe('UNSPECIFIED')
    })

    it('defaults to UNSPECIFIED when consent is absent', () => {
        const row = buildGoogleConversionsCsv([base], 'HaloTrack Purchase').csv.split('\n')[1].split(',')
        expect(row[8]).toBe('UNSPECIFIED')
        expect(row[9]).toBe('UNSPECIFIED')
    })

    it('skips a row whose per-record consent is denied', () => {
        const rec: RawConversion = { ...base, externalId: 'o-14', consent: 'denied' }
        const { rowCount, skippedCount } = buildGoogleConversionsCsv([rec], 'HaloTrack Purchase')
        expect(rowCount).toBe(0)
        expect(skippedCount).toBe(1)
    })

    describe('unsafeSkipConsentGate: true (manual-push feed only)', () => {
        it('omits both consent columns from the header row', () => {
            const { csv } = buildGoogleConversionsCsv([base], 'HaloTrack Manual Push', new Set(), { unsafeSkipConsentGate: true })
            expect(csv.split('\n')[0]).toBe(
                'Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID'
            )
        })

        it('includes a row whose session is in deniedSessions', () => {
            const denied = new Set(['sess-denied'])
            const rec = { ...base, externalId: 'o-15', sessionId: 'sess-denied' }
            const { rowCount, skippedCount } = buildGoogleConversionsCsv([rec], 'HaloTrack Manual Push', denied, { unsafeSkipConsentGate: true })
            expect(rowCount).toBe(1)
            expect(skippedCount).toBe(0)
        })

        it('includes a row whose per-record consent is denied', () => {
            const rec: RawConversion = { ...base, externalId: 'o-16', consent: 'denied' }
            const { rowCount, skippedCount } = buildGoogleConversionsCsv([rec], 'HaloTrack Manual Push', new Set(), { unsafeSkipConsentGate: true })
            expect(rowCount).toBe(1)
            expect(skippedCount).toBe(0)
        })

        it('still skips rows with no click id (matching constraint, unaffected by unsafeSkipConsentGate)', () => {
            const rec = { ...base, externalId: 'o-17', clickIds: {} }
            const { rowCount, skippedCount } = buildGoogleConversionsCsv([rec], 'HaloTrack Manual Push', new Set(), { unsafeSkipConsentGate: true })
            expect(rowCount).toBe(0)
            expect(skippedCount).toBe(1)
        })
    })
})
