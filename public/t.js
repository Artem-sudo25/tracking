// public/t.js
// HaloTrack Loader - Add to external sites

(function () {
    var SITE_URL = document.currentScript ? new URL(document.currentScript.src).origin : '';

    var ENDPOINT = SITE_URL + '/api/touch';
    var IDENTIFY_ENDPOINT = SITE_URL + '/api/identify';
    var EVENT_ENDPOINT = SITE_URL + '/api/event';

    function getCookie(name) {
        var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    function post(endpoint, body) {
        return fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            keepalive: true,
            body: JSON.stringify(body)
        });
    }

    // --- Public API ---
    // Defined BEFORE any network call so forms can always reach it. If /api/touch
    // fails, getSessionId() still works off the _halo cookie from a prior visit,
    // and identify/track calls queue until the touch call settles.
    var ready = false;
    var pending = [];

    function apiCall(endpoint, body) {
        if (!ready) {
            return new Promise(function (resolve, reject) {
                pending.push({ endpoint: endpoint, body: body, resolve: resolve, reject: reject });
            });
        }
        return post(endpoint, body);
    }

    function flushPending() {
        ready = true;
        pending.splice(0).forEach(function (item) {
            post(item.endpoint, item.body).then(item.resolve, item.reject);
        });
    }

    window.HaloTrack = {
        sessionId: getCookie('_halo') || null,

        getSessionId: function () {
            return this.sessionId || getCookie('_halo');
        },

        identify: function (userData) {
            return apiCall(IDENTIFY_ENDPOINT, userData);
        },

        track: function (eventName, properties) {
            return apiCall(EVENT_ENDPOINT, {
                event_name: eventName,
                properties: properties
            });
        }
    };

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
        ga_session_id: (function() {
            // _ga_<CONTAINER> cookie holds GA4's own session id. Needed for
            // Measurement Protocol session stitching — without it server-side
            // conversions report as "Unassigned" in GA4.
            //   GS1.1.1719930000.5.1.1719930100.0.0.0   → 3rd segment
            //   GS2.1.s1719930000$o5$g1$t1719930100$j0  → digits after "s"
            var m = document.cookie.match(/(?:^|;\s*)_ga_[^=]+=([^;]+)/);
            if (!m) return null;
            var v = m[1];
            var s2 = v.match(/^GS\d+\.\d+\.s(\d+)/);
            if (s2) return s2[1];
            var parts = v.split('.');
            return (parts.length >= 3 && /^\d+$/.test(parts[2])) ? parts[2] : null;
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

    // Touch call with retry: a single flaky request on mobile must not cost
    // the session. Retries twice (1s, 4s), then gives up but still unblocks
    // queued identify/track calls (the cookie session may still be valid).
    function postTouch(attempt) {
        data.consent = getConsent();

        post(ENDPOINT, data)
            .then(function (r) { return r.json(); })
            .then(function (result) {
                if (result && result.session_id) {
                    window.HaloTrack.sessionId = result.session_id;
                }
                flushPending();
                window.dispatchEvent(new CustomEvent('halotrack:ready'));
            })
            .catch(function (err) {
                if (attempt < 2) {
                    setTimeout(function () { postTouch(attempt + 1); }, attempt === 0 ? 1000 : 4000);
                } else {
                    console.error('HaloTrack error:', err);
                    flushPending();
                    window.dispatchEvent(new CustomEvent('halotrack:ready'));
                }
            });
    }

    // Cookiebot loads asynchronously and may not be defined yet when this script runs.
    // Always attach the event listener first, then decide whether to also fire immediately.
    var hasFired = false;
    function fireOnce() {
        if (hasFired) return;
        hasFired = true;
        postTouch(0);
    }

    window.addEventListener('CookiebotOnConsentReady', fireOnce, { once: true });

    // Custom banner support: the site dispatches `halo:consent-changed` after
    // saving halo_cookie_consent. First choice fires tracking; a change after
    // the initial fire re-sends the touch so the session's consent updates.
    window.addEventListener('halo:consent-changed', function () {
        if (!hasFired) {
            fireOnce();
        } else {
            data.consent = getConsent();
            post(ENDPOINT, data).catch(function () {});
        }
    });

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
