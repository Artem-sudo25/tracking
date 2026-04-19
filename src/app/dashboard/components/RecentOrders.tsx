'use client'

import { useState, Fragment } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, Facebook, BarChart2 } from 'lucide-react'
import { format } from 'date-fns'

const PAGE_SIZES = [10, 25, 50, 100]

const MATCH_COLORS: Record<string, string> = {
    session:     'bg-green-100 text-green-800',
    email:       'bg-blue-100 text-blue-800',
    phone:       'bg-purple-100 text-purple-800',
    customer_id: 'bg-yellow-100 text-yellow-800',
    none:        'bg-gray-100 text-gray-500',
}

function fmt(amount: number, currency = 'CZK') {
    return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency }).format(amount)
}

export function RecentOrders({ orders }: { orders: any[] }) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(25)

    const totalPages = Math.ceil(orders.length / pageSize)
    const pageOrders = orders.slice(page * pageSize, (page + 1) * pageSize)

    function toggle(id: string) {
        setExpanded(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }

    return (
        <Card className="col-span-full">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
                <CardTitle>Orders ({orders.length})</CardTitle>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    Show
                    <select
                        value={pageSize}
                        onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
                        className="border rounded px-2 py-1 text-sm bg-background"
                    >
                        {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    per page
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                                <th className="w-8 px-4 py-3" />
                                <th className="text-left px-4 py-3">Date</th>
                                <th className="text-left px-4 py-3">Order #</th>
                                <th className="text-left px-4 py-3">Customer</th>
                                <th className="text-left px-4 py-3">Attribution</th>
                                <th className="text-left px-4 py-3">Match</th>
                                <th className="text-right px-4 py-3">Amount</th>
                                <th className="text-center px-4 py-3">Sent</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pageOrders.map(order => {
                                const isOpen = expanded.has(order.id)
                                const ft = order.attribution_data?.first_touch
                                const lt = order.attribution_data?.last_touch
                                const clicks = order.attribution_data?.click_ids
                                const device = order.attribution_data?.device
                                const matchType = order.match_type || 'none'

                                return (
                                    <Fragment key={order.id}>
                                        <tr
                                            className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                                            onClick={() => toggle(order.id)}
                                        >
                                            <td className="px-4 py-3 text-muted-foreground">
                                                {isOpen
                                                    ? <ChevronDown className="h-4 w-4" />
                                                    : <ChevronRight className="h-4 w-4" />}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                                                {format(new Date(order.created_at), 'MMM d, HH:mm')}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs">
                                                #{order.external_order_id}
                                            </td>
                                            <td className="px-4 py-3 max-w-[200px] truncate">
                                                {order.customer_email || '—'}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground">
                                                {ft?.source || 'direct'} / {ft?.medium || '(none)'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${MATCH_COLORS[matchType] || MATCH_COLORS.none}`}>
                                                    {matchType}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                                                {fmt(order.total_amount, order.currency)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-center gap-2">
                                                    <span title={order.sent_to_facebook ? 'Sent to Facebook' : 'Not sent to Facebook'}>
                                                        <Facebook className={`h-4 w-4 ${order.sent_to_facebook ? 'text-blue-500' : 'text-muted-foreground/30'}`} />
                                                    </span>
                                                    <span title={order.sent_to_google ? 'Sent to Google' : 'Not sent to Google'}>
                                                        <BarChart2 className={`h-4 w-4 ${order.sent_to_google ? 'text-orange-500' : 'text-muted-foreground/30'}`} />
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>

                                        {isOpen && (
                                            <tr className="border-b bg-muted/20">
                                                <td colSpan={8} className="px-6 py-5">
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                                                        {/* Items */}
                                                        <div>
                                                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Items</p>
                                                            <div className="space-y-1">
                                                                {order.items?.map((item: any, i: number) => (
                                                                    <div key={i} className="text-sm">
                                                                        <span className="font-medium">{item.name}</span>
                                                                        <span className="text-muted-foreground"> × {item.quantity}</span>
                                                                        <span className="float-right">{fmt(item.price, order.currency)}</span>
                                                                    </div>
                                                                ))}
                                                                {(!order.items || order.items.length === 0) && (
                                                                    <p className="text-sm text-muted-foreground">No items</p>
                                                                )}
                                                            </div>
                                                            <div className="mt-3 pt-2 border-t space-y-1 text-sm text-muted-foreground">
                                                                {order.subtotal != null && <div className="flex justify-between"><span>Subtotal</span><span>{fmt(order.subtotal, order.currency)}</span></div>}
                                                                {order.shipping != null && <div className="flex justify-between"><span>Shipping</span><span>{fmt(order.shipping, order.currency)}</span></div>}
                                                                {order.tax != null && <div className="flex justify-between"><span>Tax</span><span>{fmt(order.tax, order.currency)}</span></div>}
                                                                <div className="flex justify-between font-medium text-foreground pt-1 border-t">
                                                                    <span>Total</span><span>{fmt(order.total_amount, order.currency)}</span>
                                                                </div>
                                                            </div>
                                                            {order.customer_phone && (
                                                                <p className="mt-2 text-sm text-muted-foreground">📞 {order.customer_phone}</p>
                                                            )}
                                                        </div>

                                                        {/* Attribution */}
                                                        <div>
                                                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Attribution</p>
                                                            <div className="space-y-2 text-sm">
                                                                <div>
                                                                    <p className="text-xs text-muted-foreground">First touch</p>
                                                                    <p>{ft?.source || 'direct'} / {ft?.medium || '(none)'}</p>
                                                                    {ft?.campaign && <p className="text-muted-foreground text-xs">Campaign: {ft.campaign}</p>}
                                                                    {ft?.landing && <p className="text-muted-foreground text-xs truncate" title={ft.landing}>{ft.landing}</p>}
                                                                    {ft?.timestamp && <p className="text-muted-foreground text-xs">{format(new Date(ft.timestamp), 'MMM d, HH:mm')}</p>}
                                                                </div>
                                                                {lt && (
                                                                    <div className="pt-2 border-t">
                                                                        <p className="text-xs text-muted-foreground">Last touch</p>
                                                                        <p>{lt.source || 'direct'} / {lt.medium || '(none)'}</p>
                                                                        {lt.campaign && <p className="text-muted-foreground text-xs">Campaign: {lt.campaign}</p>}
                                                                        {lt.landing && <p className="text-muted-foreground text-xs truncate" title={lt.landing}>{lt.landing}</p>}
                                                                    </div>
                                                                )}
                                                                {order.days_to_convert != null && (
                                                                    <p className="pt-2 border-t text-muted-foreground">
                                                                        {order.days_to_convert === 0 ? 'Same-day conversion' : `Converted in ${order.days_to_convert} day${order.days_to_convert !== 1 ? 's' : ''}`}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Device & signals */}
                                                        <div>
                                                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Device & Signals</p>
                                                            <div className="space-y-1 text-sm">
                                                                {device?.browser && <div className="flex justify-between"><span className="text-muted-foreground">Browser</span><span>{device.browser}</span></div>}
                                                                {device?.os && <div className="flex justify-between"><span className="text-muted-foreground">OS</span><span>{device.os}</span></div>}
                                                                {device?.type && <div className="flex justify-between"><span className="text-muted-foreground">Device</span><span>{device.type}</span></div>}
                                                                {device?.country && <div className="flex justify-between"><span className="text-muted-foreground">Country</span><span>{device.country}</span></div>}
                                                                <div className="pt-2 border-t space-y-1">
                                                                    <div className="flex justify-between"><span className="text-muted-foreground">_fbc</span><span>{clicks?.fbc ? '✓' : '—'}</span></div>
                                                                    <div className="flex justify-between"><span className="text-muted-foreground">_fbp</span><span>{clicks?.fbp ? '✓' : '—'}</span></div>
                                                                    <div className="flex justify-between"><span className="text-muted-foreground">gclid</span><span>{clicks?.gclid ? '✓' : '—'}</span></div>
                                                                    <div className="flex justify-between"><span className="text-muted-foreground">fbclid</span><span>{clicks?.fbclid ? '✓' : '—'}</span></div>
                                                                </div>
                                                                {order.session_id && (
                                                                    <p className="pt-2 border-t font-mono text-xs text-muted-foreground break-all">{order.session_id}</p>
                                                                )}
                                                            </div>
                                                        </div>

                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                )
                            })}

                            {orders.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                                        No orders in this period.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t">
                        <span className="text-sm text-muted-foreground">
                            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, orders.length)} of {orders.length} orders
                        </span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                                Previous
                            </Button>
                            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                                Next
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
