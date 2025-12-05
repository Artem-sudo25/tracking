-- Create ad_spend table (simplified version without foreign key for now)
CREATE TABLE IF NOT EXISTS ad_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  date DATE NOT NULL,
  source VARCHAR(255) NOT NULL,
  medium VARCHAR(255) NOT NULL,
  campaign VARCHAR(255),
  spend DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'CZK',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint for entries with campaign
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_spend_unique_with_campaign 
  ON ad_spend(client_id, date, source, medium, campaign) 
  WHERE campaign IS NOT NULL;

-- Unique constraint for entries without campaign
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_spend_unique_without_campaign 
  ON ad_spend(client_id, date, source, medium) 
  WHERE campaign IS NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ad_spend_client_date ON ad_spend(client_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_spend_source ON ad_spend(client_id, source, medium);

-- RLS Policies
ALTER TABLE ad_spend ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own ad spend" ON ad_spend;
DROP POLICY IF EXISTS "Users can insert their own ad spend" ON ad_spend;
DROP POLICY IF EXISTS "Users can update their own ad spend" ON ad_spend;
DROP POLICY IF EXISTS "Users can delete their own ad spend" ON ad_spend;

-- Create policies
CREATE POLICY "Users can view their own ad spend"
  ON ad_spend FOR SELECT
  USING (
    client_id IN (
      SELECT client_id FROM clients WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own ad spend"
  ON ad_spend FOR INSERT
  WITH CHECK (
    client_id IN (
      SELECT client_id FROM clients WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own ad spend"
  ON ad_spend FOR UPDATE
  USING (
    client_id IN (
      SELECT client_id FROM clients WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own ad spend"
  ON ad_spend FOR DELETE
  USING (
    client_id IN (
      SELECT client_id FROM clients WHERE user_id = auth.uid()
    )
  );
