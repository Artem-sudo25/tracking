export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'lost'
export type LeadListScope = 'period' | 'all_time'

export interface LeadTouchData {
  source?: string | null
  medium?: string | null
  campaign?: string | null
  term?: string | null
  content?: string | null
  referrer?: string | null
  landing?: string | null
  timestamp?: string | null
}

export interface LeadClickIds {
  gclid?: string | null
  fbclid?: string | null
  fbc?: string | null
  fbp?: string | null
  ttclid?: string | null
}

export interface LeadDeviceData {
  type?: string | null
  browser?: string | null
  os?: string | null
  country?: string | null
}

export interface LeadAttributionData {
  session_id?: string | null
  first_touch?: LeadTouchData | null
  last_touch?: LeadTouchData | null
  click_ids?: LeadClickIds | null
  url_params?: Record<string, string> | null
  device?: LeadDeviceData | null
  match_type?: string | null
}

export interface LeadListItem {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  form_type: string | null
  lead_value: number | null
  status: LeadStatus | null
  created_at: string
  message: string | null
  custom_fields: Record<string, unknown> | null
  attribution_data: LeadAttributionData | null
}

export interface LeadsDashboardStats {
  totalLeads: number
  costPerLead: number
  topSource: string
  leadsInPeriod: number
  timeLabel: string
  newLeadsCount: number
}

export interface LeadsDashboardData {
  stats: LeadsDashboardStats
  leadsByFormType: Array<{
    formType: string
    count: number
    value: number
  }>
  leadsBySource: Array<{
    source: string
    medium: string
    count: number
    value: number
    spend: number
    cpl: number
  }>
  recentLeads: LeadListItem[]
  recentLeadsTotal: number
  chartData: Array<{
    date: string
    leads: number
  }>
}

export interface LeadListPage {
  leads: LeadListItem[]
  total: number
  hasMore: boolean
  scope: LeadListScope
}

export interface PipelineMetricsData {
  total: number
  statusCounts: Record<string, number>
  winRate: number
  bySource: Array<{
    source: string
    total: number
    won: number
    value: number
    winRate: number
  }>
}

export interface VisitorAnalyticsData {
  totalVisitors: number
  totalPageViews: number
  bounceRate: number
  pagesPerSession: number
  leadsCount: number
  customersCount: number
  visitorToLeadRate: number
  leadToCustomerRate: number
  visitorToCustomerRate: number
  visitorsBySource: Array<{
    source: string
    medium: string
    visitors: number
    bounceRate: number
  }>
}
