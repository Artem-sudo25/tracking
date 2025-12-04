import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface RecentOrdersProps {
    orders: any[]
}

export function RecentOrders({ orders }: RecentOrdersProps) {
    return (
        <Card className="col-span-3">
            <CardHeader>
                <CardTitle>Recent Orders</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-8">
                    {orders.map((order) => (
                        <div key={order.id} className="flex items-center">
                            <Avatar className="h-9 w-9">
                                <AvatarFallback>{order.customer_email?.substring(0, 2).toUpperCase() || '??'}</AvatarFallback>
                            </Avatar>
                            <div className="ml-4 space-y-1">
                                <p className="text-sm font-medium leading-none">{order.customer_email}</p>
                                <p className="text-sm text-muted-foreground">
                                    {order.attribution_data?.first_touch?.source || 'Direct'} / {order.attribution_data?.first_touch?.medium || 'None'}
                                </p>
                            </div>
                            <div className="ml-auto font-medium">
                                +{new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(order.total_amount)}
                            </div>
                        </div>
                    ))}
                    {orders.length === 0 && (
                        <p className="text-sm text-muted-foreground">No orders yet.</p>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
