<?php
/**
 * Plugin Name: Nej Balonky Debug Logger
 * Description: Captures WordPress/WooCommerce request context and POSTs it to a Supabase debug endpoint whenever (a) the Hostinger temp domain is hit, or (b) any order-received/thank-you page is loaded. Drop into wp-content/mu-plugins/ — NO activation required.
 * Version: 1.0.0
 * Author: Nej Balonky tracking
 */

if (!defined('ABSPATH')) { exit; }

// ============================================================================
// CONFIG — change these if you need to
// ============================================================================
if (!defined('NBK_DEBUG_ENDPOINT')) {
    define('NBK_DEBUG_ENDPOINT', 'https://aiwzeqqzpvzycddfpxvt.supabase.co/functions/v1/debug-log');
}
if (!defined('NBK_DEBUG_TOKEN')) {
    define('NBK_DEBUG_TOKEN', 'nbk_debug_beacon_2026_a8f3k29x');
}
if (!defined('NBK_CANONICAL_HOST')) {
    define('NBK_CANONICAL_HOST', 'nejbalonky.cz');
}
// URL-path fragments that indicate a WooCommerce thank-you/order-received page.
// Add or remove slugs as your site uses.
if (!defined('NBK_THANKYOU_SLUGS')) {
    define('NBK_THANKYOU_SLUGS', 'objednavka-prijata|order-received|dekujeme|thank-you');
}

// ============================================================================

add_action('init', function () {
    // --- Decide whether to log this request ---------------------------------
    $host = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
    $uri  = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '';

    // Skip noise: admin, AJAX, cron, REST favicon, robots, asset files
    if (is_admin() || wp_doing_ajax() || wp_doing_cron()) { return; }
    if (preg_match('~\.(ico|css|js|png|jpe?g|gif|svg|woff2?|ttf|map)(\?|$)~i', $uri)) { return; }

    $is_wrong_host = ($host !== '' && stripos($host, NBK_CANONICAL_HOST) === false);
    $is_thankyou   = ($uri !== '' && preg_match('~/(' . NBK_THANKYOU_SLUGS . ')/~i', $uri) === 1);

    if (!$is_wrong_host && !$is_thankyou) { return; }

    // --- Capture request context --------------------------------------------
    $headers = function_exists('getallheaders') ? getallheaders() : [];

    // Strip cookies and auth headers from the headers dump (they can be PII)
    if (is_array($headers)) {
        foreach (['Cookie', 'cookie', 'Authorization', 'authorization'] as $h) {
            if (isset($headers[$h])) { unset($headers[$h]); }
        }
    }

    $server_vars = [];
    foreach ($_SERVER as $k => $v) {
        // Omit potentially sensitive or purely local paths
        if (preg_match('/^(PHP|_|HTTP_AUTHORIZATION|HTTP_COOKIE|DOCUMENT_ROOT|PATH|SCRIPT_FILENAME|SCRIPT_NAME|CONTEXT_|ORIG_)/', $k)) {
            continue;
        }
        // Only scalar values
        if (!is_scalar($v)) { continue; }
        $server_vars[$k] = (string) $v;
    }

    $order_id = null;
    if (isset($_GET['order-received'])) { $order_id = (string) $_GET['order-received']; }

    // HaloTrack cookie presence (value NOT logged — only presence, for privacy)
    $halo_cookie_present = isset($_COOKIE['_halo']) && $_COOKIE['_halo'] !== '';

    // Names of all cookies sent in this request (values stripped)
    $cookie_names = is_array($_COOKIE) ? array_keys($_COOKIE) : [];

    $wc_checkout_url = function_exists('wc_get_checkout_url') ? wc_get_checkout_url() : null;
    $wc_thankyou_url = null;
    if (function_exists('wc_get_endpoint_url') && $wc_checkout_url) {
        $wc_thankyou_url = wc_get_endpoint_url('order-received', '', $wc_checkout_url);
    }

    $payload = [
        'client_id'         => 'client_nejbalonky',
        'source'            => 'php',
        'event_type'        => $is_thankyou ? 'thankyou_hit' : 'wrong_host_hit',
        'http_host'         => $host ?: null,
        'request_uri'       => $uri ?: null,
        'referer'           => isset($_SERVER['HTTP_REFERER']) ? (string) $_SERVER['HTTP_REFERER'] : null,
        'x_forwarded_host'  => isset($_SERVER['HTTP_X_FORWARDED_HOST']) ? (string) $_SERVER['HTTP_X_FORWARDED_HOST'] : null,
        'x_forwarded_for'   => isset($_SERVER['HTTP_X_FORWARDED_FOR']) ? (string) $_SERVER['HTTP_X_FORWARDED_FOR'] : null,
        'x_forwarded_proto' => isset($_SERVER['HTTP_X_FORWARDED_PROTO']) ? (string) $_SERVER['HTTP_X_FORWARDED_PROTO'] : null,
        'server_name'       => isset($_SERVER['SERVER_NAME']) ? (string) $_SERVER['SERVER_NAME'] : null,
        'server_addr'       => isset($_SERVER['SERVER_ADDR']) ? (string) $_SERVER['SERVER_ADDR'] : null,
        'remote_addr'       => isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : null,
        'user_agent'        => isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : null,
        'wp_home_url'       => function_exists('home_url') ? home_url() : null,
        'wp_site_url'       => function_exists('site_url') ? site_url() : null,
        'wp_option_home'    => function_exists('get_option') ? get_option('home') : null,
        'wp_option_siteurl' => function_exists('get_option') ? get_option('siteurl') : null,
        'wc_checkout_url'   => $wc_checkout_url,
        'wc_thankyou_url'   => $wc_thankyou_url,
        'is_cached'              => isset($_SERVER['HTTP_X_LITESPEED_CACHE']) ? (string) $_SERVER['HTTP_X_LITESPEED_CACHE'] : null,
        'order_id'               => $order_id,
        'session_cookie_present' => $halo_cookie_present,
        'raw_payload' => [
            'halo' => [
                'cookie_present' => $halo_cookie_present,
            ],
            'cookie_names'    => $cookie_names,
            'server_vars'     => $server_vars,
            'request_headers' => $headers,
            'wp_version'      => get_bloginfo('version'),
            'php_version'     => PHP_VERSION,
            'active_plugins'  => (array) get_option('active_plugins', []),
            'timestamp'       => gmdate('c'),
        ],
    ];

    // --- Fire-and-forget POST (non-blocking) --------------------------------
    wp_remote_post(NBK_DEBUG_ENDPOINT, [
        'timeout'  => 2,
        'blocking' => false, // don't slow the customer's page load
        'headers'  => [
            'Content-Type'   => 'application/json',
            'x-beacon-token' => NBK_DEBUG_TOKEN,
        ],
        'body' => wp_json_encode($payload),
    ]);
}, 1);
