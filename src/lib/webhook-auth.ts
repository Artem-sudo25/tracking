// src/lib/webhook-auth.ts
// Webhook authentication: HMAC signature (preferred) with legacy shared-secret
// header fallback, so existing client sites keep working during migration.
//
// Signed scheme:
//   x-halo-timestamp: unix seconds
//   x-halo-signature: hex(HMAC_SHA256(`${timestamp}.${rawBody}`, WEBHOOK_SECRET))
// The timestamp must be within 5 minutes, which blocks replaying a captured
// request. The legacy x-webhook-secret header has no replay protection —
// migrate client sites to the signed scheme and then remove the fallback.

const TOLERANCE_SECONDS = 5 * 60

export async function verifyWebhook(request: Request, rawBody: string): Promise<boolean> {
    const secret = process.env.WEBHOOK_SECRET
    if (!secret) return false

    const signature = request.headers.get('x-halo-signature')
    const timestamp = request.headers.get('x-halo-timestamp')

    if (signature && timestamp) {
        const ts = parseInt(timestamp, 10)
        if (!Number.isFinite(ts)) return false
        if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false

        const expected = await hmacSha256Hex(`${timestamp}.${rawBody}`, secret)
        return timingSafeEqualHex(signature.toLowerCase(), expected)
    }

    // Legacy: static shared secret header
    return request.headers.get('x-webhook-secret') === secret
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
    return Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

function timingSafeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return diff === 0
}
