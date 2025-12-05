'use client'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BarChart3, ShoppingCart, LayoutGrid } from 'lucide-react'

type ViewType = 'leads' | 'purchases' | 'combined'

interface ViewToggleProps {
    currentView: ViewType
    onChange: (view: ViewType) => void
}

export function ViewToggle({ currentView, onChange }: ViewToggleProps) {
    return (
        <Tabs value={currentView} onValueChange={(value) => onChange(value as ViewType)}>
            <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
                <TabsTrigger value="leads" className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    <span className="hidden sm:inline">Leads</span>
                </TabsTrigger>
                <TabsTrigger value="purchases" className="flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4" />
                    <span className="hidden sm:inline">Purchases</span>
                </TabsTrigger>
                <TabsTrigger value="combined" className="flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4" />
                    <span className="hidden sm:inline">Combined</span>
                </TabsTrigger>
            </TabsList>
        </Tabs>
    )
}
