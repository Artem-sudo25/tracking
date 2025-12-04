// HaloTrack TypeScript Type Definitions

// Database Table Types
export interface Client {
  id: string
  client_id: string
  name: string
  domain: string
  user_id: string | null
  settings: ClientSettings
  created_at: string
  active: boolean
}

export interface ClientSettings {
  currency: string
  timezone: string
  facebook?: {
    pixel_id: string | null
    access_token: string | null
    test_event_code: string | null
  }
  google?: {
    measurement_id: string | null
    api_secret: string | null
  }
}

export interface Session {
  id: string
  client_id: string
  session_id: string

  // First Touch Attribution
  ft_source: string | null
  ft_medium: string | null
  ft_campaign: string | null
  ft_term: string | null
  ft_content: string | null
  ft_referrer: string | null
  ft_referrer_full: string | null
  ft_landing: string | null
  ft_timestamp: string | null

  // Last Touch Attribution
  lt_source: string | null
  lt_medium: string | null
  lt_campaign: string | null
  lt_term: string | null
  lt_content: string | null
  lt_referrer: string | null
  lt_landing: string | null
  lt_timestamp: string | null

  // Ad Platform Click IDs
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
  fbc: string | null
  fbp: string | null
  ttclid: string | null
  msclkid: string | null

  // Device Info
  user_agent: string | null
  device_type: string | null
  browser: string | null
  browser_version: string | null
  os: string | null
  os_version: string | null

  // Geo
  ip_hash: string | null
  country: string | null
  city: string | null
  region: string | null

  // User Preferences
  language: string | null

  // Identity
  email: string | null
  phone: string | null
  external_id: string | null

  // Consent
  consent_status: 'granted' | 'denied' | 'unknown'

  // Flexible Storage
  custom_params: Record<string, any>

  // Meta
  created_at: string
  updated_at: string
}

export interface Order {
  id: string
  client_id: string
  external_order_id: string
  platform: string

  // Money
  total_amount: number
  subtotal: number | null
  tax: number | null
  shipping: number | null
  currency: string

  // Customer
  customer_email: string | null
  customer_phone: string | null
  customer_id: string | null

  // Products
  items: OrderItem[] | null

  // Attribution
  session_id: string | null
  attribution_data: AttributionData | null
  match_type: 'session' | 'email' | 'phone' | 'customer_id' | 'none'
  days_to_convert: number | null

  // Forwarding Status
  sent_to_facebook: boolean
  sent_to_google: boolean
  facebook_event_id: string | null
  google_event_id: string | null

  created_at: string
}

export interface OrderItem {
  id: string
  name: string
  price: number
  quantity: number
}

export interface AttributionData {
  session_id?: string
  first_touch?: TouchData
  last_touch?: TouchData
  click_ids?: ClickIds
  device?: DeviceData
  match_type: string
  deleted?: boolean
  deletion_date?: string
}

export interface TouchData {
  source: string | null
  medium: string | null
  campaign: string | null
  term: string | null
  content: string | null
  referrer: string | null
  landing: string | null
  timestamp: string | null
}

export interface ClickIds {
  gclid?: string | null
  fbclid?: string | null
  fbc?: string | null
  fbp?: string | null
  ttclid?: string | null
}

export interface DeviceData {
  type: string | null
  browser: string | null
  os: string | null
  country: string | null
}

export interface Event {
  id: string
  client_id: string
  session_id: string
  event_name: string
  event_category: string | null
  event_value: number | null
  currency: string | null
  page_url: string | null
  page_title: string | null
  items: OrderItem[] | null
  properties: Record<string, any>
  sent_to_facebook: boolean
  sent_to_google: boolean
  created_at: string
}

export interface AnonEvent {
  id: string
  client_id: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  referrer_domain: string | null
  page_path: string | null
  event_type: string
  created_at: string
}

// API Request/Response Types
export interface NormalizedOrder {
  external_id: string
  platform: string
  total: number
  subtotal: number
  tax: number
  shipping: number
  currency: string
  email: string | null
  phone: string | null
  customer_id: string | null
  session_id: string | null
  items: OrderItem[] | null
}

export interface FacebookParams {
  session: Session
  order: NormalizedOrder
  eventId: string
  pixelId: string
  accessToken: string
  testEventCode?: string
}

export interface GoogleParams {
  session: Session
  order: NormalizedOrder
  measurementId: string
  apiSecret: string
}

export interface ForwardingResult {
  success: boolean
  response?: any
  error?: any
}

// Dashboard Types
export interface DashboardStats {
  totalRevenue: number
  totalOrders: number
  attributionRate: number
  avgDaysToConvert: number
}

export interface RevenueBySourceItem {
  source: string
  medium: string
  orders: number
  revenue: number
}

export interface ChartDataPoint {
  date: string
  revenue: number
}

export interface DashboardData {
  stats: DashboardStats
  revenueBySource: RevenueBySourceItem[]
  recentOrders: Order[]
  chartData: ChartDataPoint[]
}

// Webhook Types
export interface WooCommerceWebhook {
  id: number
  order_id?: number
  total: string
  subtotal?: string
  total_tax?: string
  shipping_total?: string
  currency: string
  billing?: {
    email?: string
    phone?: string
  }
  customer_id?: number
  line_items?: WooCommerceLineItem[]
  meta_data?: Array<{
    key: string
    value: any
  }>
  halo_session_id?: string
}

export interface WooCommerceLineItem {
  product_id: number
  name: string
  price: string
  quantity: number
}

export interface ShopifyWebhook {
  id: number
  order_number?: number
  checkout_token?: string
  total_price: string
  subtotal_price?: string
  total_tax?: string
  total_shipping_price_set?: {
    shop_money?: {
      amount: string
    }
  }
  currency: string
  email?: string
  phone?: string
  customer?: {
    id?: number
    email?: string
    phone?: string
  }
  line_items?: ShopifyLineItem[]
  note_attributes?: Array<{
    name: string
    value: any
  }>
}

export interface ShopifyLineItem {
  product_id: number
  title: string
  price: string
  quantity: number
}

// Utility Types
export interface DateRange {
  from: Date
  to: Date
}
