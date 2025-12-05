-- Touchpoints Table (for full customer journey tracking)
CREATE TABLE touchpoints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  session_id TEXT NOT NULL, -- Actually maps to Visitor ID (_halo cookie) or Session ID depending on implementation
  
  -- Marketing Data
  source TEXT,
  medium TEXT,
  campaign TEXT,
  term TEXT,
  content TEXT,
  
  -- Ad Platform IDs
  gclid TEXT,
  fbclid TEXT,
  ttclid TEXT,
  msclkid TEXT,
  
  -- Context
  referrer TEXT,
  landing_page TEXT,
  page_path TEXT,
  
  -- Ordering
  touchpoint_number INTEGER, -- 1st, 2nd, 3rd interaction
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast retrieval of journey
CREATE INDEX idx_touchpoints_session ON touchpoints(client_id, session_id);
CREATE INDEX idx_touchpoints_created ON touchpoints(created_at);
CREATE INDEX idx_touchpoints_source ON touchpoints(source);

-- RLS
ALTER TABLE touchpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON touchpoints FOR ALL USING (true);
