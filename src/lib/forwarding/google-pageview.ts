
interface GooglePageViewParams {
    session: any
    url: string
    title?: string
    measurementId: string
    apiSecret: string
}

export async function sendPageViewToGoogle(params: GooglePageViewParams) {
    const { session, url, title, measurementId, apiSecret } = params

    try {
        // Measurement Protocol PageView
        const payload = {
            client_id: session.session_id,
            // Google Signals / User ID matching if available
            user_id: session.user_id || undefined,
            events: [{
                name: 'page_view',
                params: {
                    page_location: url,
                    page_title: title || undefined,
                    engagement_time_msec: 1, // Required to show as engaged
                    session_id: session.session_id, // Pass our session ID as GA4 session (might need tweaking for exact match)
                },
            }],
            user_data: {
                // We send SHA256 PII if we have it hashed in session or can re-hash
                // For PageView we usually don't have PII unless logged in
            },
        }

        const response = await fetch(
            `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
            {
                method: 'POST',
                body: JSON.stringify(payload),
            }
        )

        return {
            success: response.ok,
        }

    } catch (error) {
        console.error('Google PageView error:', error)
        return { success: false, error }
    }
}
