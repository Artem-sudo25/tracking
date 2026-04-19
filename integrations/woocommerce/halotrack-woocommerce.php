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

// ─── HPOS compatibility ───────────────────────────────────────────────────────
// Declare plugin compatible with High-Performance Order Storage so that
// $order->get_meta() reads / writes go to wc_orders_meta (not wp_postmeta).

add_action( 'before_woocommerce_init', function () {
    if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
            'custom_order_tables', __FILE__, true
        );
    }
} );

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

    // Inject session ID into checkout form — JS-driven so it works regardless
    // of which checkout template the theme uses (Shoptimizer, custom, etc.)
    // Inject session ID into checkout form — works with any theme template
    wp_add_inline_script( 'halotrack', "
        (function () {
            function setHaloSessionId() {
                if (!window.HaloTrack) return;

                var field = document.getElementById('halo_session_id');

                // Field not rendered by WC — find form and create it manually
                if (!field) {
                    var form = document.querySelector('form.checkout, form.woocommerce-checkout, form[name=\"checkout\"]');
                    if (!form) return;
                    field = document.createElement('input');
                    field.type = 'hidden';
                    field.id   = 'halo_session_id';
                    field.name = 'halo_session_id';
                    form.appendChild(field);
                }

                field.value = window.HaloTrack.getSessionId();
            }

            // Set on HaloTrack ready + DOM ready
            document.addEventListener('halotrack:ready', setHaloSessionId);
            document.addEventListener('DOMContentLoaded', setHaloSessionId);

            // Re-set after every WooCommerce AJAX checkout refresh
            // (WC wipes the field value when it recalculates shipping/totals)
            document.addEventListener('DOMContentLoaded', function () {
                if (window.jQuery) {
                    jQuery(document.body).on('updated_checkout', setHaloSessionId);
                }
            });

            // Final safety net: set value right before form submits
            document.addEventListener('submit', function (e) {
                var f = e.target;
                if (f && (f.classList.contains('checkout') || f.classList.contains('woocommerce-checkout') || f.name === 'checkout')) {
                    setHaloSessionId();
                }
            }, true); // capture phase — fires before WooCommerce serialises the form
        })();
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

/**
 * Capture HaloTrack session ID and customer IP onto an order.
 * Called from multiple hooks to cover Classic + Blocks checkout + WC 10.x.
 *
 * Session ID sources (in priority order):
 *   1. $_POST['halo_session_id']     — classic checkout hidden field
 *   2. Store API JSON body           — extensions.halotrack.session_id or
 *                                      top-level halo_session_id (Blocks checkout)
 *   3. $_COOKIE['_halo']             — first-party cookie set by /api/touch
 *                                      (fallback, cross-subdomain via .nejbalonky.cz)
 *
 * No-ops if _halo_session is already present on the order (earlier hook won).
 * Logs only on complete capture failure (all three sources empty).
 */
function halotrack_capture_session( WC_Order $order, string $hook = 'unknown' ): void {
    // Already captured by an earlier hook — don't overwrite
    if ( $order->get_meta( '_halo_session' ) ) {
        return;
    }

    $session_id = '';

    // 1. Classic checkout POST field
    if ( ! empty( $_POST['halo_session_id'] ) ) {
        $session_id = sanitize_text_field( wp_unslash( $_POST['halo_session_id'] ) );
    }

    // 2. Store API: body param (Blocks checkout)
    if ( empty( $session_id ) ) {
        $raw = file_get_contents( 'php://input' );
        if ( $raw ) {
            $json = json_decode( $raw, true );
            if ( is_array( $json ) ) {
                if ( ! empty( $json['extensions']['halotrack']['session_id'] ) ) {
                    $session_id = sanitize_text_field( $json['extensions']['halotrack']['session_id'] );
                } elseif ( ! empty( $json['halo_session_id'] ) ) {
                    $session_id = sanitize_text_field( $json['halo_session_id'] );
                }
            }
        }
    }

    // 3. Cookie fallback (_halo cookie set by /api/touch)
    if ( empty( $session_id ) && ! empty( $_COOKIE['_halo'] ) ) {
        $session_id = sanitize_text_field( $_COOKIE['_halo'] );
    }

    if ( ! empty( $session_id ) ) {
        $order->update_meta_data( '_halo_session', $session_id );
    } else {
        // Only log when every source is empty — this is actionable (tracking
        // didn't reach this user, or the cookie was scoped wrong, etc.)
        error_log(
            "[HaloTrack] capture [$hook] order=" . $order->get_id() .
            " — no session_id found (POST, Store API body, _halo cookie all empty)"
        );
    }

    // Customer IP — needed for geo since webhook fires server-to-server
    $ip = WC_Geolocation::get_ip_address();
    if ( ! empty( $ip ) ) {
        $order->update_meta_data( '_halo_customer_ip', $ip );
    }

    $order->save();
}

// Universal hook — fires for EVERY new order regardless of checkout flow
// (classic shortcode, Blocks Store API, REST API, manual admin creation)
add_action( 'woocommerce_new_order', function ( int $order_id, WC_Order $order ) {
    halotrack_capture_session( $order, 'woocommerce_new_order' );
}, 10, 2 );

// Classic checkout — WC 7.2+
add_action( 'woocommerce_checkout_order_created', function ( WC_Order $order ) {
    halotrack_capture_session( $order, 'woocommerce_checkout_order_created' );
} );

// Classic checkout — legacy hook (WC < 7.2, belt-and-suspenders)
add_action( 'woocommerce_checkout_update_order_meta', function ( int $order_id ) {
    $order = wc_get_order( $order_id );
    if ( $order ) {
        halotrack_capture_session( $order, 'woocommerce_checkout_update_order_meta' );
    }
} );

// Blocks checkout — Store API (WooCommerce Blocks / WC 8.3+ default for new installs)
add_action( 'woocommerce_store_api_checkout_update_order_from_request',
    function ( WC_Order $order, \WP_REST_Request $request ) {
        halotrack_capture_session( $order, 'woocommerce_store_api_checkout_update_order_from_request' );
    }, 10, 2
);

// ─── 4. Forward order to HaloTrack on payment complete ────────────────────────

add_action( 'woocommerce_payment_complete', 'halotrack_forward_order' );

// Also catch orders that go directly to processing (e.g. bank transfer)
add_action( 'woocommerce_order_status_processing', 'halotrack_forward_order' );

function halotrack_forward_order( int $order_id ): void {
    if ( ! halotrack_is_configured() ) {
        return;
    }

    $order = wc_get_order( $order_id );
    if ( ! $order ) {
        return;
    }

    // Prevent double-firing (payment_complete + status_processing can both fire).
    // Use CRUD API — works with both HPOS and legacy post-meta storage.
    if ( $order->get_meta( '_halo_forwarded' ) === 'yes' ) {
        return;
    }

    $session_id  = $order->get_meta( '_halo_session' );
    $customer_ip = $order->get_meta( '_halo_customer_ip' );

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
        $order->update_meta_data( '_halo_forwarded', 'yes' );
        $order->update_meta_data( '_halo_forwarded_at', current_time( 'mysql' ) );
        $order->save();
    } else {
        $body = wp_remote_retrieve_body( $response );
        error_log( '[HaloTrack] Order ' . $order_id . ' forward failed — HTTP ' . $code . ': ' . $body );
    }
}
