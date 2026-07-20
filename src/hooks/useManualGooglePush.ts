'use client'

// src/hooks/useManualGooglePush.ts
// Shared state + logic for the "Push to Google" manual-conversion control
// used by both LeadsManager.tsx and RecentLeads.tsx. Centralizing this fixes
// two bugs that existed when each component reimplemented it independently:
//
// 1. The value <input> must be fully CONTROLLED (value=, not defaultValue).
//    startEditing() seeds the draft from the lead's current pushed value the
//    moment edit mode opens, so clicking "Update" without retyping resubmits
//    the same value instead of silently overwriting it with null.
// 2. pushingIds is a Set, not a single id, so pushing lead A doesn't affect
//    lead B's button state when both are mid-request at once.

import { useState } from 'react'
import { pushLeadToGoogleAds, cancelGoogleAdsPush } from '@/app/actions/dashboard'

export type PushFeedback = { tone: 'success' | 'error'; text: string }

export interface ManualPushPatch {
    manual_google_push_at: string | null
    manual_google_push_value: number | null
}

export function consentLabel(status?: 'granted' | 'unknown' | 'denied' | null): string {
    if (status === 'denied') return 'Denied'
    if (status === 'granted') return 'Granted'
    return 'Unknown'
}

export function useManualGooglePush(onPushed: (leadId: string, patch: ManualPushPatch) => void) {
    const [valueDrafts, setValueDrafts] = useState<Record<string, string>>({})
    const [editingIds, setEditingIds] = useState<Set<string>>(new Set())
    const [pushingIds, setPushingIds] = useState<Set<string>>(new Set())
    const [feedback, setFeedback] = useState<Record<string, PushFeedback>>({})

    const startEditing = (leadId: string, currentValue?: number | null) => {
        setValueDrafts((prev) => ({
            ...prev,
            [leadId]: currentValue != null ? String(currentValue) : (prev[leadId] ?? ''),
        }))
        setEditingIds((prev) => new Set(prev).add(leadId))
    }

    const setDraft = (leadId: string, raw: string) => {
        setValueDrafts((prev) => ({ ...prev, [leadId]: raw }))
    }

    const push = async (leadId: string) => {
        setPushingIds((prev) => new Set(prev).add(leadId))

        const raw = valueDrafts[leadId]
        const parsed = raw && raw.trim() !== '' ? parseFloat(raw) : undefined
        const value = parsed !== undefined && Number.isNaN(parsed) ? undefined : parsed

        const result = await pushLeadToGoogleAds(leadId, value)

        setPushingIds((prev) => {
            const next = new Set(prev)
            next.delete(leadId)
            return next
        })

        if (!result.success) {
            setFeedback((prev) => ({
                ...prev,
                [leadId]: { tone: 'error', text: result.error || 'Could not push this lead.' },
            }))
            return
        }

        onPushed(leadId, {
            manual_google_push_at: result.pushedAt,
            manual_google_push_value: result.pushedValue ?? null,
        })
        setFeedback((prev) => {
            const next = { ...prev }
            delete next[leadId]
            return next
        })
        setEditingIds((prev) => {
            const next = new Set(prev)
            next.delete(leadId)
            return next
        })
    }

    // Undoes a push in HaloTrack (removes it from future CSV pulls). Cannot
    // retroactively un-count a conversion Google Ads already ingested on a
    // past pull — see the comment on cancelGoogleAdsPush.
    const cancel = async (leadId: string) => {
        setPushingIds((prev) => new Set(prev).add(leadId))

        const result = await cancelGoogleAdsPush(leadId)

        setPushingIds((prev) => {
            const next = new Set(prev)
            next.delete(leadId)
            return next
        })

        if (!result.success) {
            setFeedback((prev) => ({
                ...prev,
                [leadId]: { tone: 'error', text: result.error || 'Could not cancel this push.' },
            }))
            return
        }

        onPushed(leadId, { manual_google_push_at: null, manual_google_push_value: null })
        setFeedback((prev) => {
            const next = { ...prev }
            delete next[leadId]
            return next
        })
        setValueDrafts((prev) => {
            const next = { ...prev }
            delete next[leadId]
            return next
        })
        setEditingIds((prev) => {
            const next = new Set(prev)
            next.delete(leadId)
            return next
        })
    }

    return { valueDrafts, editingIds, pushingIds, feedback, startEditing, setDraft, push, cancel }
}
