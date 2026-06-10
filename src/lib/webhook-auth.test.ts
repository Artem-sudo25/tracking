import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyWebhook } from './webhook-auth'

const SECRET = process.env.WEBHOOK_SECRET! // set in vitest.setup.ts

function makeRequest(headers: Record<string, string>): Request {
    return new Request('https://track.example.com/api/webhook/lead', {
        method: 'POST',
        headers,
    })
}

function sign(timestamp: string, body: string, secret = SECRET): string {
    return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

describe('verifyWebhook — HMAC scheme', () => {
    const body = JSON.stringify({ email: 'a@b.cz', lead_id: 'l1' })

    it('accepts a valid signature', async () => {
        const ts = Math.floor(Date.now() / 1000).toString()
        const req = makeRequest({ 'x-halo-timestamp': ts, 'x-halo-signature': sign(ts, body) })
        expect(await verifyWebhook(req, body)).toBe(true)
    })

    it('rejects a tampered body', async () => {
        const ts = Math.floor(Date.now() / 1000).toString()
        const req = makeRequest({ 'x-halo-timestamp': ts, 'x-halo-signature': sign(ts, body) })
        expect(await verifyWebhook(req, body + ' ')).toBe(false)
    })

    it('rejects a signature made with the wrong secret', async () => {
        const ts = Math.floor(Date.now() / 1000).toString()
        const req = makeRequest({ 'x-halo-timestamp': ts, 'x-halo-signature': sign(ts, body, 'wrong') })
        expect(await verifyWebhook(req, body)).toBe(false)
    })

    it('rejects a replayed (stale) timestamp', async () => {
        const stale = (Math.floor(Date.now() / 1000) - 10 * 60).toString()
        const req = makeRequest({ 'x-halo-timestamp': stale, 'x-halo-signature': sign(stale, body) })
        expect(await verifyWebhook(req, body)).toBe(false)
    })

    it('rejects a garbage timestamp', async () => {
        const req = makeRequest({ 'x-halo-timestamp': 'soon', 'x-halo-signature': sign('soon', body) })
        expect(await verifyWebhook(req, body)).toBe(false)
    })
})

describe('verifyWebhook — legacy shared secret', () => {
    it('accepts the legacy header during migration', async () => {
        const req = makeRequest({ 'x-webhook-secret': SECRET })
        expect(await verifyWebhook(req, '{}')).toBe(true)
    })

    it('rejects a wrong legacy secret', async () => {
        const req = makeRequest({ 'x-webhook-secret': 'nope' })
        expect(await verifyWebhook(req, '{}')).toBe(false)
    })

    it('rejects when no auth headers are present', async () => {
        const req = makeRequest({})
        expect(await verifyWebhook(req, '{}')).toBe(false)
    })
})
