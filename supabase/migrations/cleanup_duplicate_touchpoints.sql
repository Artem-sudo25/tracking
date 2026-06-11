-- One-time data cleanup (2026-06-11), run AFTER deploying the touchpoint
-- dedupe in /api/touch.
--
-- Consent Mode URL passthrough re-appends the same gclid to every internal
-- link when ad cookies are declined, so pre-fix deployments recorded one
-- "touchpoint" per pageview (50+ per browsing session). This collapses each
-- run of consecutive identical click-id touchpoints down to its first row,
-- then renumbers so journeys read 1, 2, 3 … again.
--
-- Conservative on purpose: only deletes rows that carry a click ID identical
-- to their immediate predecessor's. UTM-only rows are left untouched.

-- Step 1: delete consecutive click-id duplicates
WITH ordered AS (
  SELECT id,
         gclid, fbclid, ttclid, msclkid, source, medium, campaign,
         LAG(source)   OVER w AS p_source,
         LAG(medium)   OVER w AS p_medium,
         LAG(campaign) OVER w AS p_campaign,
         LAG(gclid)    OVER w AS p_gclid,
         LAG(fbclid)   OVER w AS p_fbclid,
         LAG(ttclid)   OVER w AS p_ttclid,
         LAG(msclkid)  OVER w AS p_msclkid
  FROM touchpoints
  WINDOW w AS (PARTITION BY client_id, session_id ORDER BY touchpoint_number)
)
DELETE FROM touchpoints WHERE id IN (
  SELECT id FROM ordered
  WHERE source   IS NOT DISTINCT FROM p_source
    AND medium   IS NOT DISTINCT FROM p_medium
    AND campaign IS NOT DISTINCT FROM p_campaign
    AND gclid    IS NOT DISTINCT FROM p_gclid
    AND fbclid   IS NOT DISTINCT FROM p_fbclid
    AND ttclid   IS NOT DISTINCT FROM p_ttclid
    AND msclkid  IS NOT DISTINCT FROM p_msclkid
    AND (gclid IS NOT NULL OR fbclid IS NOT NULL OR ttclid IS NOT NULL OR msclkid IS NOT NULL)
);

-- Step 2: close the numbering gaps left by step 1
WITH renum AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY client_id, session_id ORDER BY touchpoint_number) AS rn
  FROM touchpoints
)
UPDATE touchpoints t
SET touchpoint_number = r.rn
FROM renum r
WHERE r.id = t.id
  AND t.touchpoint_number IS DISTINCT FROM r.rn;

-- Verify: worst remaining journeys (should be normal-sized now)
SELECT client_id, session_id, COUNT(*) AS touches
FROM touchpoints
GROUP BY client_id, session_id
ORDER BY touches DESC
LIMIT 10;
