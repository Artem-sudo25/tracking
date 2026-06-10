// src/lib/normalize.ts
// Webhook payload normalization — pure functions, extracted from the route
// handlers so they can be unit-tested (App Router route files can only
// export route handlers).

export interface LeadWebhookBody {
    lead_id?: string
    id?: string
    source?: string
    email?: string
    phone?: string
    name?: string
    first_name?: string
    last_name?: string
    company?: string
    form_type?: string
    message?: string
    comments?: string
    value?: number | string
    lead_value?: number | string
    currency?: string
    custom_fields?: Record<string, unknown>
    session_id?: string
    halo_session_id?: string
    consent_given?: boolean
    gdpr_consent?: boolean
    ip_address?: string
    created_at?: string
}

// Digits-only — matches how /api/identify stores phones on sessions, so this
// exact form is what phone-based session matching compares against.
export function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '')
}

// Normalize leads from different sources
export function normalizeLead(body: LeadWebhookBody) {
    const rawValue = body.value ?? body.lead_value ?? 0

    // Generic form format
    return {
        external_id: body.lead_id || body.id || `lead_${Date.now()}`,
        source: body.source || 'form',
        email: body.email?.toLowerCase().trim(),
        phone: body.phone ? normalizePhone(body.phone) : null,
        name: body.name || `${body.first_name || ''} ${body.last_name || ''}`.trim(),
        company: body.company || null,
        form_type: body.form_type || 'contact',
        message: body.message || body.comments || null,
        value: typeof rawValue === 'number' ? rawValue : parseFloat(rawValue),
        currency: body.currency || 'CZK',
        custom_fields: body.custom_fields || {},
        session_id: body.session_id || body.halo_session_id,
        consent_given: body.consent_given || body.gdpr_consent || false,
        ip_address: body.ip_address || null,
    }
}

// Normalize orders from different platforms
export function normalizeOrder(body: any) {
    // Shopify format — must be checked BEFORE WooCommerce: Shopify payloads
    // also contain line_items, and checkout_token/order_number are
    // Shopify-specific while WooCommerce has neither.
    if (body.checkout_token || body.order_number) {
        const haloAttr = body.note_attributes?.find((a: any) =>
            a.name === 'halo_session_id' || a.name === '_halo_session'
        )

        return {
            external_id: String(body.id || body.order_number),
            platform: 'shopify',
            total: parseFloat(body.total_price || 0),
            subtotal: parseFloat(body.subtotal_price || 0),
            tax: parseFloat(body.total_tax || 0),
            shipping: parseFloat(body.total_shipping_price_set?.shop_money?.amount || 0),
            currency: body.currency || 'CZK',
            email: body.email?.toLowerCase() || body.customer?.email?.toLowerCase(),
            phone: body.phone || body.customer?.phone,
            customer_id: body.customer?.id ? String(body.customer.id) : null,
            session_id: haloAttr?.value,
            items: body.line_items?.map((item: any) => ({
                id: String(item.product_id),
                name: item.title,
                price: parseFloat(item.price),
                quantity: item.quantity,
            })),
            ip_address: body.browser_ip || body.client_details?.browser_ip || null,
        }
    }

    // WooCommerce format
    if (body.billing || body.line_items) {
        return {
            external_id: String(body.id || body.order_id),
            platform: 'woocommerce',
            total: parseFloat(body.total || 0),
            subtotal: parseFloat(body.subtotal || 0),
            tax: parseFloat(body.total_tax || 0),
            shipping: parseFloat(body.shipping_total || 0),
            currency: body.currency || 'CZK',
            email: body.billing?.email?.toLowerCase(),
            phone: body.billing?.phone,
            customer_id: body.customer_id ? String(body.customer_id) : null,
            session_id: body.meta_data?.find((m: any) => m.key === '_halo_session')?.value ||
                body.halo_session_id,
            items: body.line_items?.map((item: any) => ({
                id: String(item.product_id),
                name: item.name,
                price: parseFloat(item.price),
                quantity: item.quantity,
            })),
            ip_address: body.customer_ip || null,
        }
    }

    // Custom/generic format
    return {
        external_id: String(body.order_id || body.id),
        platform: body.platform || 'custom',
        total: parseFloat(body.total || body.total_amount || 0),
        subtotal: parseFloat(body.subtotal || 0),
        tax: parseFloat(body.tax || 0),
        shipping: parseFloat(body.shipping || 0),
        currency: body.currency || 'CZK',
        email: body.email?.toLowerCase() || body.customer_email?.toLowerCase(),
        phone: body.phone || body.customer_phone,
        customer_id: body.customer_id,
        session_id: body.session_id || body.halo_session_id,
        items: body.items,
        ip_address: body.ip_address || body.customer_ip || null,
    }
}
