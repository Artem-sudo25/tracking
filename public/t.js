// public/t.js
// HaloTrack Loader - Add to external sites

(function () {
    // Replace with your actual site URL in production or use a variable
    // For now we assume the script is served from the same domain or we use a relative path if possible, 
    // but for external sites it needs the full URL. 
    // We'll use a placeholder that needs to be replaced or configured.
    var SITE_URL = document.currentScript ? new URL(document.currentScript.src).origin : '';

    var ENDPOINT = SITE_URL + '/api/touch';
    var IDENTIFY_ENDPOINT = SITE_URL + '/api/identify';
    var EVENT_ENDPOINT = SITE_URL + '/api/event';

    // Parse URL params
    var params = new URLSearchParams(window.location.search);

    // Get UTMs and click IDs
    var data = {
        utm_source: params.get('utm_source'),
        utm_medium: params.get('utm_medium'),
        utm_campaign: params.get('utm_campaign'),
        utm_term: params.get('utm_term'),
        utm_content: params.get('utm_content'),
        gclid: params.get('gclid'),
        fbclid: params.get('fbclid'),
        ttclid: params.get('ttclid'),
        msclkid: params.get('msclkid'),
        referrer: document.referrer || null,
        landing: window.location.pathname + window.location.search,
        page_title: document.title,
    };

    // Check consent (common CMPs)
    var consent = 'unknown';
    if (typeof window.CookieYes !== 'undefined') {
        var cky = window.CookieYes.getConsent();
        consent = cky.analytics ? 'granted' : 'denied';
    } else if (typeof window.Cookiebot !== 'undefined') {
        consent = window.Cookiebot.consent.statistics ? 'granted' : 'denied';
    }

    data.consent = consent;

    // Call server
    fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
    })
        .then(function (r) { return r.json(); })
        .then(function (result) {
            window.HaloTrack = {
                sessionId: result.session_id,

                getSessionId: function () {
                    return this.sessionId || getCookie('_halo');
                },

                identify: function (userData) {
                    return fetch(IDENTIFY_ENDPOINT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(userData)
                    });
                },

                track: function (eventName, properties) {
                    return fetch(EVENT_ENDPOINT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            event_name: eventName,
                            properties: properties
                        })
                    });
                }
            };

            // Dispatch ready event
            window.dispatchEvent(new CustomEvent('halotrack:ready'));
        })
        .catch(function (err) {
            console.error('HaloTrack error:', err);
        });

    function getCookie(name) {
        var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }
})();
