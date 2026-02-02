// lib/consent.ts

export type ConsentState = 'granted' | 'denied'

export interface ConsentSettings {
    ad_storage: ConsentState
    analytics_storage: ConsentState
    ad_user_data: ConsentState
    ad_personalization: ConsentState
}

export const defaultConsent: ConsentSettings = {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
}

export function getConsent(): ConsentSettings {
    if (typeof window === 'undefined') return defaultConsent
    try {
        const stored = localStorage.getItem('consent-settings')
        if (stored) return JSON.parse(stored)
    } catch (e) {
        // ignore
    }
    return defaultConsent
}

export function saveConsent(settings: ConsentSettings) {
    if (typeof window === 'undefined') return
    localStorage.setItem('consent-settings', JSON.stringify(settings))

    // Push to GTM
    updateGTMConsent(settings)
}

export function updateGTMConsent(settings: ConsentSettings) {
    if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('consent', 'update', settings)
    }
}
