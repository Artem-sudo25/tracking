-- Create table to track when users last viewed leads/purchases
CREATE TABLE IF NOT EXISTS user_dashboard_activity (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    last_leads_view TIMESTAMPTZ DEFAULT NOW(),
    last_purchases_view TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, client_id)
);

-- Enable RLS
ALTER TABLE user_dashboard_activity ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own activity
CREATE POLICY "Users can view own dashboard activity"
    ON user_dashboard_activity
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert their own activity
CREATE POLICY "Users can insert own dashboard activity"
    ON user_dashboard_activity
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own activity
CREATE POLICY "Users can update own dashboard activity"
    ON user_dashboard_activity
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_dashboard_activity_user_client 
    ON user_dashboard_activity(user_id, client_id);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_dashboard_activity_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_dashboard_activity_updated_at
    BEFORE UPDATE ON user_dashboard_activity
    FOR EACH ROW
    EXECUTE FUNCTION update_user_dashboard_activity_updated_at();
