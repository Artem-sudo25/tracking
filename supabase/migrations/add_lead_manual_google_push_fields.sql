-- Manual "Push to Google" conversion marking. Separate from the automatic
-- sent_to_google GA4 forward (set by the lead webhook) and the automatic
-- rolling-window CSV export (src/app/api/export/google-conversions) — this
-- tracks leads a dashboard user explicitly chose to push into a second,
-- distinct Google Ads conversion action.
--
-- manual_google_push_at: null = never manually pushed. Once set it is never
-- overwritten (see pushLeadToGoogleAds in src/app/actions/dashboard.ts) so the
-- CSV's Conversion Time stays stable across re-pulls for Google's dedup.
--
-- manual_google_push_updated_at: bumped on every push AND every later value
-- edit. The manual export route (src/app/api/export/google-conversions-manual)
-- windows its query on THIS column, not manual_google_push_at — otherwise
-- editing a lead's value long after the original push (past the export
-- window) would silently and permanently exclude the correction from ever
-- reaching Google, since manual_google_push_at itself never moves.
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS manual_google_push_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS manual_google_push_value NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS manual_google_push_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_manual_google_push_updated_at ON leads(manual_google_push_updated_at);
