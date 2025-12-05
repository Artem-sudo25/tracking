-- Add lead pipeline fields
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost')) DEFAULT 'new',
ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS deal_value NUMERIC(10,2);

-- Create index for status filtering
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

-- Update existing leads to have a default status if null (though default handles new rows)
UPDATE leads SET status = 'new' WHERE status IS NULL;
