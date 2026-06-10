-- Tier 2 fixes (2026-06-10):
-- ga_session_id: GA4's own session id from the _ga_<container> cookie.
--   Required for Measurement Protocol session stitching — without it,
--   server-side conversions report as "Unassigned" in GA4.
-- ip_address: the visitor's real IP. Meta CAPI requires client_ip_address
--   unhashed; ip_hash stays for analytics/dedup use.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ga_session_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
