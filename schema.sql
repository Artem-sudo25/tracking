-- =============================================
-- HALOTRACK SCHEMA
-- =============================================

-- CLIENTS TABLE (multi-tenant registry)
CREATE TABLE clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  
  -- Ad Platform Credentials
  settings JSONB DEFAULT '{
    "currency": "CZK",
    "timezone": "Europe/Prague",
    "facebook": {
      "pixel_id": null,
      "access_token": null,
      "test_event_code": null
    },
    "google": {
      "measurement_id": null,
      "api_secret": null
    }
  }',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT true
);

-- SESSIONS TABLE (full tracking with consent)
CREATE TABLE sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  
  -- First Touch Attribution
  ft_source TEXT,
  ft_medium TEXT,
  ft_campaign TEXT,
  ft_term TEXT,
  ft_content TEXT,
  ft_referrer TEXT,
  ft_referrer_full TEXT,
  ft_landing TEXT,
  ft_timestamp TIMESTAMPTZ,
  
  -- Last Touch Attribution
  lt_source TEXT,
  lt_medium TEXT,
  lt_campaign TEXT,
  lt_term TEXT,
  lt_content TEXT,
  lt_referrer TEXT,
  lt_landing TEXT,
  lt_timestamp TIMESTAMPTZ,
  
  -- Ad Platform Click IDs
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  fbclid TEXT,
  fbc TEXT,
  fbp TEXT,
  ttclid TEXT,
  msclkid TEXT,
  
  -- Device Info
  user_agent TEXT,
  device_type TEXT,
  browser TEXT,
  browser_version TEXT,
  os TEXT,
  os_version TEXT,
  
  -- Geo
  ip_hash TEXT,
  country TEXT,
  city TEXT,
  region TEXT,
  
  -- User Preferences
  language TEXT,
  
  -- Identity (for cross-device)
  email TEXT,
  phone TEXT,
  external_id TEXT,
  
  -- Consent
  consent_status TEXT DEFAULT 'unknown',
  
  -- Flexible Storage
  custom_params JSONB DEFAULT '{}',
  
  -- Meta
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(client_id, session_id)
);

-- ANONYMOUS EVENTS TABLE (no consent - minimal data)
CREATE TABLE anon_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  
  -- Only non-PII data
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  referrer_domain TEXT,
  page_path TEXT,
  
  -- For aggregate reporting
  event_type TEXT DEFAULT 'page_view',
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- EVENTS TABLE (tracked events with consent)
CREATE TABLE events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  
  -- Event Info
  event_name TEXT NOT NULL,
  event_category TEXT,
  event_value NUMERIC,
  currency TEXT,
  
  -- Page Context
  page_url TEXT,
  page_title TEXT,
  
  -- E-commerce
  items JSONB,
  
  -- Flexible
  properties JSONB DEFAULT '{}',
  
  -- Forwarding Status
  sent_to_facebook BOOLEAN DEFAULT false,
  sent_to_google BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ORDERS TABLE
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  
  -- Order Data
  external_order_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  
  -- Money
  total_amount NUMERIC(10,2),
  subtotal NUMERIC(10,2),
  tax NUMERIC(10,2),
  shipping NUMERIC(10,2),
  currency TEXT DEFAULT 'CZK',
  
  -- Customer
  customer_email TEXT,
  customer_phone TEXT,
  customer_id TEXT,
  
  -- Products
  items JSONB,
  
  -- Attribution
  session_id TEXT,
  attribution_data JSONB,
  match_type TEXT,
  days_to_convert INT,
  
  -- Forwarding Status
  sent_to_facebook BOOLEAN DEFAULT false,
  sent_to_google BOOLEAN DEFAULT false,
  facebook_event_id TEXT,
  google_event_id TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(client_id, external_order_id, platform)
);

-- LEADS TABLE (form submissions and lead generation)
CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  
  -- Lead Data
  external_lead_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'form',
  
  -- Contact Info
  email TEXT,
  phone TEXT,
  name TEXT,
  company TEXT,
  
  -- Lead Details
  form_type TEXT,
  message TEXT,
  lead_value NUMERIC(10,2),
  currency TEXT DEFAULT 'CZK',
  
  -- Custom Fields (flexible for different form types)
  custom_fields JSONB DEFAULT '{}',
  
  -- Attribution
  session_id TEXT,
  attribution_data JSONB,
  match_type TEXT,
  days_to_convert INT,
  
  -- Forwarding Status
  sent_to_facebook BOOLEAN DEFAULT false,
  sent_to_google BOOLEAN DEFAULT false,
  facebook_event_id TEXT,
  google_event_id TEXT,
  
  -- GDPR Compliance
  consent_given BOOLEAN DEFAULT false,
  ip_address TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(client_id, external_lead_id, source)
);


-- INDEXES
CREATE INDEX idx_sessions_client ON sessions(client_id);
CREATE INDEX idx_sessions_sid ON sessions(client_id, session_id);
CREATE INDEX idx_sessions_email ON sessions(email) WHERE email IS NOT NULL;
CREATE INDEX idx_sessions_phone ON sessions(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_sessions_gclid ON sessions(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX idx_sessions_fbclid ON sessions(fbclid) WHERE fbclid IS NOT NULL;
CREATE INDEX idx_anon_events_client ON anon_events(client_id);
CREATE INDEX idx_anon_events_created ON anon_events(created_at);
CREATE INDEX idx_events_client ON events(client_id);
CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_orders_client ON orders(client_id);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_orders_email ON orders(customer_email) WHERE customer_email IS NOT NULL;
CREATE INDEX idx_leads_client ON leads(client_id);
CREATE INDEX idx_leads_created ON leads(created_at);
CREATE INDEX idx_leads_email ON leads(email) WHERE email IS NOT NULL;
CREATE INDEX idx_leads_session ON leads(session_id) WHERE session_id IS NOT NULL;


-- ROW LEVEL SECURITY
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE anon_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;


-- Policies: Service role has full access
CREATE POLICY "Service role full access" ON sessions FOR ALL USING (true);
CREATE POLICY "Service role full access" ON events FOR ALL USING (true);
CREATE POLICY "Service role full access" ON orders FOR ALL USING (true);
CREATE POLICY "Service role full access" ON anon_events FOR ALL USING (true);
CREATE POLICY "Service role full access" ON leads FOR ALL USING (true);

