// Payload snapshot tests for the ad-platform forwarding builders. These guard
// the exact wire format: a regression here is silent data loss in production
// (wrong hashes / missing match keys never throw — platforms just match less).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { sendToFacebook } from './facebook'
import { sendLeadToFacebook } from './facebook-lead'
import { sendToGoogle } from './google'
import { sendLeadToGoogle } from './google-lead'
import { FB_GRAPH_VERSION } from './shared'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

const mockFetch = vi.fn()

beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

const session = {
    session_id: 'halo-session-uuid',
    ga_client_id: '1111111111.2222222222',
    ga_session_id: '1719930000',
    country: 'CZ',
    city: 'Prague',
    fbc: 'fb.1.1719930000.IwAR123',
    fbp: 'fb.1.1719930000.987654',
    ip_address: '203.0.113.7',
    ip_hash: 'deadbeefdeadbeefdeadbeefdeadbeef',
    user_agent: 'Mozilla/5.0 Test',
    lt_landing: '/pricing',
    ft_landing: '/',
    gclid: 'Cj0KCQtest',
} as any

describe('sendLeadToFacebook', () => {
    const lead = {
        email: ' Test@Example.com ',
        phone: '777 123 456',
        name: 'Jan Novák',
        value: 100,
        currency: 'CZK',
        form_type: 'contact',
        ip_address: '203.0.113.7',
    }

    it('builds a correct Lead payload', async () => {
        const result = await sendLeadToFacebook({
            session, lead, eventId: 'lead-abc-123', pixelId: 'PX1', accessToken: 'TOK',
        })

        expect(result.success).toBe(true)
        const event = result.payload!.data[0]
        expect(event.event_name).toBe('Lead')
        expect(event.event_id).toBe('lead-abc-123')
        // Meta wants digits-with-country-code, hashed
        expect(event.user_data.ph).toEqual([sha('420777123456')])
        expect(event.user_data.em).toEqual([sha('test@example.com')])
        expect(event.user_data.fn).toEqual([sha('jan')])
        expect(event.user_data.ln).toEqual([sha('novák')])
        // Real IP, never a hash
        expect(event.user_data.client_ip_address).toBe('203.0.113.7')
    })

    it('calls the current Graph API version', async () => {
        await sendLeadToFacebook({ session, lead, eventId: 'e', pixelId: 'PX1', accessToken: 'TOK' })
        expect(mockFetch.mock.calls[0][0]).toContain(`https://graph.facebook.com/${FB_GRAPH_VERSION}/PX1/events`)
    })
})

describe('sendToFacebook (Purchase)', () => {
    const order = {
        external_id: 'o-1001',
        email: 'a@b.cz',
        phone: '+420 777 123 456',
        total: 1500,
        currency: 'CZK',
        items: [{ id: 'p1', name: 'Product', price: 1500, quantity: 1 }],
    } as any

    it('builds a correct Purchase payload with the real IP', async () => {
        const result = await sendToFacebook({
            session, order, eventId: 'order_o-1001', pixelId: 'PX1', accessToken: 'TOK',
        })

        const event = result.payload!.data[0]
        expect(event.event_name).toBe('Purchase')
        // Deterministic id — browser pixel can dedupe against it
        expect(event.event_id).toBe('order_o-1001')
        expect(event.user_data.ph).toEqual([sha('420777123456')])
        // Regression guard: must be the raw IP, not ip_hash
        expect(event.user_data.client_ip_address).toBe('203.0.113.7')
        expect(event.custom_data.value).toBe(1500)
        expect(event.custom_data.content_ids).toEqual(['p1'])
    })

    it('prefers the checkout-time order IP over the session first-touch IP', async () => {
        const result = await sendToFacebook({
            session, order: { ...order, ip_address: '198.51.100.9' },
            eventId: 'order_o-1001', pixelId: 'PX1', accessToken: 'TOK',
        })

        expect(result.payload!.data[0].user_data.client_ip_address).toBe('198.51.100.9')
    })
})

describe('sendLeadToGoogle', () => {
    const lead = {
        email: 'a@b.cz',
        phone: '777123456',
        value: 50,
        currency: 'CZK',
        form_type: 'contact',
        external_id: 'lead-abc-123',
    }

    it('stitches to the GA4 session and hashes the phone as E.164', async () => {
        const result = await sendLeadToGoogle({
            session, lead, measurementId: 'G-TEST', apiSecret: 'SECRET',
        })

        expect(result.success).toBe(true)
        expect(result.payload!.client_id).toBe('1111111111.2222222222')

        const params = result.payload!.events[0].params
        // GA4's own session id — anything else reports as Unassigned
        expect(params.session_id).toBe('1719930000')
        expect(params.engagement_time_msec).toBe(1)
        expect(params.transaction_id).toBe('lead-abc-123')
        // gclid anchors the event to the ad click — restored 2026-07 after
        // its June removal sent conversions to "Unassigned"
        expect(params.gclid).toBe('Cj0KCQtest')
        // Google requires E.164 before hashing
        expect(result.payload!.user_data.sha256_phone_number).toBe(sha('+420777123456'))
    })

    it('omits session_id when the GA4 session cookie was not captured', async () => {
        const result = await sendLeadToGoogle({
            session: { ...session, ga_session_id: null },
            lead, measurementId: 'G-TEST', apiSecret: 'SECRET',
        })
        expect('session_id' in result.payload!.events[0].params).toBe(false)
    })

    it('omits gclid when the session has none (organic / non-Google traffic)', async () => {
        const result = await sendLeadToGoogle({
            session: { ...session, gclid: null },
            lead, measurementId: 'G-TEST', apiSecret: 'SECRET',
        })
        expect('gclid' in result.payload!.events[0].params).toBe(false)
    })

    it('skips sending (does not fall back to the internal session id) when ga_client_id is missing', async () => {
        const result = await sendLeadToGoogle({
            session: { ...session, ga_client_id: null },
            lead, measurementId: 'G-TEST', apiSecret: 'SECRET',
        })
        expect(result.success).toBe(false)
        expect(result.payload).toBeUndefined()
        expect(mockFetch).not.toHaveBeenCalled()
    })
})

describe('sendToGoogle (purchase)', () => {
    const order = {
        external_id: 'o-1001',
        email: 'a@b.cz',
        phone: '777 123 456',
        total: 1500,
        currency: 'CZK',
        items: [{ id: 'p1', name: 'Product', price: 1500, quantity: 1 }],
    } as any

    it('builds a correct purchase payload', async () => {
        const result = await sendToGoogle({
            session, order, measurementId: 'G-TEST', apiSecret: 'SECRET',
        })

        const params = result.payload!.events[0].params
        expect(result.payload!.events[0].name).toBe('purchase')
        expect(params.transaction_id).toBe('o-1001')
        expect(params.session_id).toBe('1719930000')
        expect(params.engagement_time_msec).toBe(1)
        expect(params.gclid).toBe('Cj0KCQtest')
        expect(result.payload!.user_data.sha256_phone_number).toBe(sha('+420777123456'))
        expect(params.items).toEqual([{ item_id: 'p1', item_name: 'Product', price: 1500, quantity: 1 }])
    })

    it('skips sending (does not fall back to the internal session id) when ga_client_id is missing', async () => {
        const result = await sendToGoogle({
            session: { ...session, ga_client_id: null },
            order, measurementId: 'G-TEST', apiSecret: 'SECRET',
        })
        expect(result.success).toBe(false)
        expect(result.payload).toBeUndefined()
        expect(mockFetch).not.toHaveBeenCalled()
    })
})
