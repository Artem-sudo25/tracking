<?php
/**
 * Plugin Name: HaloTrack for WooCommerce
 * Description: First-party attribution tracking for WooCommerce. Captures UTM/click IDs per session and forwards order conversions to Meta CAPI and Google Measurement Protocol via HaloTrack.
 * Version: 1.0.0
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 7.0
 */

defined( 'ABSPATH' ) || exit;

// ─── Settings page ────────────────────────────────────────────────────────────

add_action( 'admin_menu', function () {
    add_options_page(
        'HaloTrack',
        'HaloTrack',
        'manage_options',
        'halotrack',
        'halotrack_settings_page'
    );
} );

add_action( 'admin_init', function () {
    register_setting( 'halotrack', 'halotrack_url',            [ 'sanitize_callback' => 'esc_url_raw' ] );
    register_setting( 'halotrack', 'halotrack_webhook_secret', [ 'sanitize_callback' => 'sanitize_text_field' ] );

    add_settings_section( 'halotrack_main', 'Connection', null, 'halotrack' );

    add_settings_field( 'halotrack_url', 'HaloTrack URL', function () {
        $val = get_option( 'halotrack_url', '' );
        echo '<input type="url" name="halotrack_url" value="' . esc_attr( $val ) . '" class="regular-text" placeholder="https://cdn.nejbalonky.cz" />';
        echo '<p class="description">Full URL of your HaloTrack deployment — no trailing slash.</p>';
    }, 'halotrack', 'halotrack_main' );

    add_settings_field( 'halotrack_webhook_secret', 'Webhook Secret', function () {
        $val = get_option( 'halotrack_webhook_secret', '' );
        echo '<input type="password" name="halotrack_webhook_secret" value="' . esc_attr( $val ) . '" class="regular-text" />';
        echo '<p class="description">Must match <code>WEBHOOK_SECRET</code> in your Vercel environment variables.</p>';
    }, 'halotrack', 'halotrack_main' );
} );

function halotrack_settings_page() {
    ?>
    <div class="wrap">
        <h1>HaloTrack</h1>
        <form method="post" action="options.php">
            <?php
            settings_fields( 'halotrack' );
            do_settings_sections( 'halotrack' );
            submit_button();
            ?>
        </form>
    </div>
    <?php
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function halotrack_url(): string {
    return rtrim( get_option( 'halotrack_url', '' ), '/' );
}

function halotrack_secret(): string {
    return get_option( 'halotrack_webhook_secret', '' );
}

function halotrack_is_configured(): bool {
    return ! empty( halotrack_url() ) && ! empty( halotrack_secret() );
}

// ─── 1. Load t.js on every page ───────────────────────────────────────────────

add_action( 'wp_enqueue_scripts', function () {
    $url = halotrack_url();
    if ( empty( $url ) ) {
        return;
    }

    // t.js — non-blocking, loaded from first-party subdomain
    wp_enqueue_script(
        'halotrack',
        $url . '/t.js',
        [],
        null,   // no version — HaloTrack manages cache busting
        false   // load in <head> so session ID is ready before checkout JS runs
    );

    // Inject session ID into checkout hidden field once HaloTrack is ready
    wp_add_inline_script( 'halotrack', "
        document.addEventListener('halotrack:ready', function () {
            var field = document.getElementById('halo_session_id');
            if (field && window.HaloTrack) {
                field.value = window.HaloTrack.getSessionId();
            }
        });

        // Fallback: also try on DOMContentLoaded in case event already fired
        document.addEventListener('DOMContentLoaded', function () {
            var field = document.getElementById('halo_session_id');
            if (field && window.HaloTrack && !field.value) {
                field.value = window.HaloTrack.getSessionId();
            }
        });
    " );
} );

// ─── 2. Add hidden session ID field to checkout form ──────────────────────────

add_filter( 'woocommerce_checkout_fields', function ( $fields ) {
    $fields['order']['halo_session_id'] = [
        'type'    => 'hidden',
        'default' => '',
        'label'   => '',
    ];
    return $fields;
} );

// Render the hidden input (WooCommerce doesn't auto-render hidden fields)
add_action( 'woocommerce_checkout_before_order_review', function () {
    echo '<input type="hidden" id="halo_session_id" name="halo_session_id" value="" />';
} );

// ─── 3. Save session ID to order meta when order is placed ────────────────────

add_action( 'woocommerce_checkout_update_order_meta', function ( $order_id ) {
    $session_id = isset( $_POST['halo_session_id'] )
        ? sanitize_text_field( wp_unslash( $_POST['halo_session_id'] ) )
        : '';

    if ( ! empty( $session_id ) ) {
        update_post_meta( $order_id, '_halo_session', $session_id );
    }

    // Also capture customer IP at order time (needed for HaloTrack geo since
    // the webhook fires server-to-server, not from the customer's browser)
    $ip = WC_Geolocation::get_ip_address();
    if ( ! empty( $ip ) ) {
        update_post_meta( $order_id, '_halo_customer_ip', $ip );
    }
} );

// ─── 4. Forward order to HaloTrack on payment complete ────────────────────────

add_action( 'woocommerce_payment_complete', 'halotrack_forward_order' );

// Also catch orders that go directly to processing (e.g. bank transfer)
add_action( 'woocommerce_order_status_processing', 'halotrack_forward_order' );

function halotrack_forward_order( int $order_id ): void {
    if ( ! halotrack_is_configured() ) {
        return;
    }

    // Prevent double-firing (payment_complete + status_processing can both fire)
    if ( get_post_meta( $order_id, '_halo_forwarded', true ) === 'yes' ) {
        return;
    }

    $order = wc_get_order( $order_id );
    if ( ! $order ) {
        return;
    }

    $session_id  = get_post_meta( $order_id, '_halo_session', true );
    $customer_ip = get_post_meta( $order_id, '_halo_customer_ip', true );

    // Build line items
    $line_items = [];
    foreach ( $order->get_items() as $item ) {
        /** @var WC_Order_Item_Product $item */
        $line_items[] = [
            'product_id' => (string) $item->get_product_id(),
            'name'       => $item->get_name(),
            'price'      => (float) ( $item->get_total() / max( 1, $item->get_quantity() ) ),
            'quantity'   => $item->get_quantity(),
        ];
    }

    // Build payload in WooCommerce format — HaloTrack normalizes this natively
    $payload = [
        'id'             => $order->get_id(),
        'currency'       => $order->get_currency(),
        'total'          => (float) $order->get_total(),
        'subtotal'       => (float) $order->get_subtotal(),
        'total_tax'      => (float) $order->get_total_tax(),
        'shipping_total' => (float) $order->get_shipping_total(),
        'customer_id'    => $order->get_customer_id() ?: null,
        'billing'        => [
            'email' => $order->get_billing_email(),
            'phone' => $order->get_billing_phone(),
            'city'  => $order->get_billing_city(),
        ],
        'line_items'     => $line_items,
        // Session ID in meta_data format — matches HaloTrack's WooCommerce normalizer
        'meta_data'      => [
            [ 'key' => '_halo_session', 'value' => $session_id ?: '' ],
        ],
        // Pass customer IP explicitly so HaloTrack can geo-resolve it
        // (webhook fires server-to-server, so request IP would be Hostinger's)
        'customer_ip'    => $customer_ip ?: '',
    ];

    $response = wp_remote_post(
        halotrack_url() . '/api/webhook/order',
        [
            'timeout'     => 10,
            'headers'     => [
                'Content-Type'     => 'application/json',
                'x-webhook-secret' => halotrack_secret(),
            ],
            'body'        => wp_json_encode( $payload ),
            'data_format' => 'body',
        ]
    );

    if ( is_wp_error( $response ) ) {
        error_log( '[HaloTrack] Order ' . $order_id . ' forward failed: ' . $response->get_error_message() );
        return;
    }

    $code = wp_remote_retrieve_response_code( $response );

    if ( $code >= 200 && $code < 300 ) {
        update_post_meta( $order_id, '_halo_forwarded', 'yes' );
        update_post_meta( $order_id, '_halo_forwarded_at', current_time( 'mysql' ) );
    } else {
        $body = wp_remote_retrieve_body( $response );
        error_log( '[HaloTrack] Order ' . $order_id . ' forward failed — HTTP ' . $code . ': ' . $body );
    }
}
