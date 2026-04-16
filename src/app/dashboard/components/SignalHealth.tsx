'use client'

import type { SignalHealthData, SignalHealthMetric } from '@/types/dashboard'
import { AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react'

interface SignalHealthProps {
  data: SignalHealthData
}

function healthBg(rate: number): string {
  if (rate >= 0.9) return 'bg-green-50 border-green-200'
  if (rate >= 0.7) return 'bg-yellow-50 border-yellow-200'
  return 'bg-red-50 border-red-200'
}

function healthTextColor(rate: number): string {
  if (rate >= 0.9) return 'text-green-700'
  if (rate >= 0.7) return 'text-yellow-700'
  return 'text-red-700'
}

function StatusIcon({ rate }: { rate: number }) {
  if (rate >= 0.9) return <CheckCircle className="h-4 w-4 text-green-600" />
  if (rate >= 0.7) return <AlertTriangle className="h-4 w-4 text-yellow-600" />
  return <AlertCircle className="h-4 w-4 text-red-600" />
}

function HealthMetric({ label, metric }: { label: string; metric: SignalHealthMetric }) {
  const pct = metric.total > 0 ? Math.round(metric.rate * 100) : null

  return (
    <div className={`rounded-lg border p-4 ${healthBg(metric.rate)}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <StatusIcon rate={metric.rate} />
      </div>
      <div className={`text-2xl font-bold ${healthTextColor(metric.rate)}`}>
        {pct !== null ? `${pct}%` : '—'}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        {pct !== null ? `${metric.sent} / ${metric.total}` : 'No data'}
      </div>
    </div>
  )
}

export function SignalHealth({ data }: SignalHealthProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xl font-bold">Signal Health</h4>
        <span className="text-xs text-gray-500">Last 30 days</span>
      </div>

      {data.deadItems > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <span className="text-sm text-red-800">
            <strong>{data.deadItems}</strong> forwarding{data.deadItems === 1 ? '' : 's'} permanently failed — query{' '}
            <code className="font-mono text-xs">{'forwarding_queue WHERE status = \'dead\''}</code> for details
          </span>
        </div>
      )}

      {data.queuedRetries > 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
          <span className="text-sm text-yellow-800">
            <strong>{data.queuedRetries}</strong> conversion{data.queuedRetries === 1 ? '' : 's'} queued for retry
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <HealthMetric label="Leads → Facebook" metric={data.fbLeads} />
        <HealthMetric label="Leads → Google" metric={data.googleLeads} />
        <HealthMetric label="Session Match" metric={data.matchRate} />
        <HealthMetric label="GA Client ID" metric={data.gaClientId} />
        <HealthMetric label="Facebook fbc" metric={data.fbc} />
        <HealthMetric label="Geo (Country)" metric={data.country} />
      </div>
    </div>
  )
}
