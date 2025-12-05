-- Check if sessions exist for propradlo
SELECT 
  session_id,
  ft_source,
  ft_medium,
  ft_campaign,
  created_at
FROM sessions
WHERE client_id = 'propradlo'
ORDER BY created_at DESC
LIMIT 10;

-- Check recent leads
SELECT 
  lead_id,
  name,
  session_id,
  attribution_data->'first_touch'->>'source' as source,
  created_at
FROM leads
WHERE client_id = 'propradlo'
ORDER BY created_at DESC
LIMIT 5;
