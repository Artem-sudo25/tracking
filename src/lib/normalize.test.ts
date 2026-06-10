import { describe, it, expect } from 'vitest'
import { normalizeLead, normalizeOrder, normalizePhone } from './normalize'

describe('normalizePhone (session matching format)', () => {
    it('strips to digits only', () => {
        expect(normalizePhone('+420 777-123-456')).toBe('420777123456')
        expect(normalizePhone('777 123 456')).toBe('777123456')
    })
})

describe('normalizeLead', () => {
    it('normalizes a typical form submission', () => {
        const lead = normalizeLead({
            lead_id: 'l1',
            email: ' Test@Example.com ',
            phone: '+420 777 123 456',
            first_name: 'Jan',
            last_name: 'Novák',
            form_type: 'contact',
            lead_value: '250',
            gdpr_consent: true,
            halo_session_id: 'sess-1',
        })

        expect(lead.external_id).toBe('l1')
        expect(lead.email).toBe('test@example.com')
        expect(lead.phone).toBe('420777123456')
        expect(lead.name).toBe('Jan Novák')
        expect(lead.value).toBe(250)
        expect(lead.consent_given).toBe(true)
        expect(lead.session_id).toBe('sess-1')
        expect(lead.currency).toBe('CZK')
    })

    it('defaults consent to false when not provided', () => {
        expect(normalizeLead({ lead_id: 'l2', email: 'a@b.cz' }).consent_given).toBe(false)
    })
})

describe('normalizeOrder — platform detection', () => {
    it('detects WooCommerce and extracts the _halo_session meta field', () => {
        const order = normalizeOrder({
            id: 1001,
            total: '1500.00',
            currency: 'CZK',
            billing: { email: 'A@B.cz', phone: '777123456' },
            customer_id: 7,
            meta_data: [{ key: '_other', value: 'x' }, { key: '_halo_session', value: 'sess-woo' }],
            line_items: [{ product_id: 5, name: 'Balloon', price: '750', quantity: 2 }],
            customer_ip: '198.51.100.9',
        })

        expect(order.platform).toBe('woocommerce')
        expect(order.external_id).toBe('1001')
        expect(order.total).toBe(1500)
        expect(order.email).toBe('a@b.cz')
        expect(order.customer_id).toBe('7')
        expect(order.session_id).toBe('sess-woo')
        expect(order.items).toEqual([{ id: '5', name: 'Balloon', price: 750, quantity: 2 }])
        // Woo plugin sends the checkout-time visitor IP as customer_ip
        expect(order.ip_address).toBe('198.51.100.9')
    })

    it('detects Shopify and reads halo_session_id from note_attributes', () => {
        const order = normalizeOrder({
            id: 2002,
            checkout_token: 'tok',
            total_price: '900.00',
            currency: 'CZK',
            email: 'C@D.cz',
            customer: { id: 9 },
            note_attributes: [{ name: 'halo_session_id', value: 'sess-shopify' }],
            line_items: [{ product_id: 3, title: 'Cup', price: '900', quantity: 1 }],
            browser_ip: '198.51.100.10',
        })

        expect(order.platform).toBe('shopify')
        expect(order.external_id).toBe('2002')
        expect(order.email).toBe('c@d.cz')
        expect(order.customer_id).toBe('9')
        expect(order.session_id).toBe('sess-shopify')
        expect(order.items).toEqual([{ id: '3', name: 'Cup', price: 900, quantity: 1 }])
        expect(order.ip_address).toBe('198.51.100.10')
    })

    it('falls back to the generic format', () => {
        const order = normalizeOrder({
            order_id: 'x-1',
            total_amount: 300,
            customer_email: 'E@F.cz',
            session_id: 'sess-generic',
        })

        expect(order.platform).toBe('custom')
        expect(order.external_id).toBe('x-1')
        expect(order.total).toBe(300)
        expect(order.email).toBe('e@f.cz')
        expect(order.session_id).toBe('sess-generic')
        // No IP in the payload — must be null, not undefined
        expect(order.ip_address).toBe(null)
    })
})
