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

    function getCookie(name) {
        var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    // Parse URL params
    var params = new URLSearchParams(window.location.search);

    // Get UTMs and click IDs
    var data = {
        utm_source: params.get('utm_source'),
        utm_medium: params.get('utm_medium'),
        utm_campaign: params.get('utm_campaign'),
        utm_term: params.get('utm_term'),
        utm_content: params.get('utm_content'),
        custom_params: Object.fromEntries(params.entries()),
        gclid: params.get('gclid'),
        fbclid: params.get('fbclid'),
        ttclid: params.get('ttclid'),
        msclkid: params.get('msclkid'),
        referrer: document.referrer || null,
        landing: window.location.pathname + window.location.search,
        page_title: document.title,
        fbc: getCookie('_fbc'),
        fbp: getCookie('_fbp'),
        ga_client_id: (function() {
            var ga = getCookie('_ga');
            if (!ga) return null;
            // _ga cookie format: GA1.1.XXXXXXXXXX.XXXXXXXXXX — extract the last two parts
            var parts = ga.split('.');
            return parts.length >= 4 ? parts.slice(2).join('.') : ga;
        })(),
        navigation_type: (typeof PerformanceNavigationTiming !== 'undefined' &&
            performance.getEntriesByType('navigation')[0])
            ? performance.getEntriesByType('navigation')[0].type
            : null,
    };

    function getConsent() {
        if (typeof window.CookieYes !== 'undefined') {
            var cky = window.CookieYes.getConsent();
            return cky.analytics ? 'granted' : 'denied';
        }
        if (typeof window.Cookiebot !== 'undefined') {
            return window.Cookiebot.consent.statistics ? 'granted' : 'denied';
        }
        try {
            var haloConsent = localStorage.getItem('halo_cookie_consent');
            if (haloConsent) {
                var parsed = JSON.parse(haloConsent);
                return parsed.analytics ? 'granted' : 'denied';
            }
        } catch {}
        return 'unknown';
    }

    function fireTracking() {
        data.consent = getConsent();

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

                window.dispatchEvent(new CustomEvent('halotrack:ready'));
            })
            .catch(function (err) {
                console.error('HaloTrack error:', err);
            });
    }

    // Cookiebot loads asynchronously and may not be defined yet when this script runs.
    // Always attach the event listener first, then decide whether to also fire immediately.
    var hasFired = false;
    function fireOnce() {
        if (hasFired) return;
        hasFired = true;
        fireTracking();
    }

    window.addEventListener('CookiebotOnConsentReady', fireOnce, { once: true });

    if (typeof window.Cookiebot !== 'undefined') {
        // Cookiebot loaded before this script — fire now if it already has a response
        if (window.Cookiebot.consent.hasResponse) fireOnce();
        // else hasResponse=false means banner is showing; CookiebotOnConsentReady will fire on accept
    } else if (typeof window.CookieYes !== 'undefined') {
        fireOnce();
    } else {
        try { if (localStorage.getItem('halo_cookie_consent')) fireOnce(); } catch {}
    }

    // Fallback on window load: covers (a) Cookiebot already fired before our listener was added,
    // (b) no CMP on the page at all. By load time window.Cookiebot.consent is fully populated.
    var onLoad = function() { setTimeout(fireOnce, 200); };
    if (document.readyState === 'complete') {
        onLoad();
    } else {
        window.addEventListener('load', onLoad, { once: true });
    }

})();
