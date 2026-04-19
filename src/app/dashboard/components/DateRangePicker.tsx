'use client'

import * as React from 'react'
import { CalendarIcon } from 'lucide-react'
import { format } from 'date-fns'
import { DateRange } from '@/types'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface DateRangePickerProps {
  date: DateRange
  onDateChange: (date: DateRange) => void
  className?: string
}

export function DateRangePicker({
  date,
  onDateChange,
  className,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <div className={cn('grid gap-2', className)}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant="outline"
            className={cn(
              'w-[300px] justify-start text-left font-normal',
              !date && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, 'LLL dd, y')} -{' '}
                  {format(date.to, 'LLL dd, y')}
                </>
              ) : (
                format(date.from, 'LLL dd, y')
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={{ from: date?.from, to: date?.to }}
            onSelect={(range) => {
              if (range?.from && range?.to) {
                onDateChange({ from: range.from, to: range.to })
                setIsOpen(false)
              } else if (range?.from) {
                onDateChange({ from: range.from, to: range.from })
              }
            }}
            numberOfMonths={2}
          />
          <div className="grid grid-cols-5 gap-2 p-3 border-t">
            {[
              { label: 'Today', fn: () => { const d = new Date(); return { from: d, to: d } } },
              { label: 'Yesterday', fn: () => { const d = new Date(); d.setDate(d.getDate() - 1); return { from: d, to: d } } },
              { label: 'Last 7d', fn: () => { const t = new Date(); const f = new Date(); f.setDate(t.getDate() - 7); return { from: f, to: t } } },
              { label: 'Last 30d', fn: () => { const t = new Date(); const f = new Date(); f.setDate(t.getDate() - 30); return { from: f, to: t } } },
              { label: 'Last 90d', fn: () => { const t = new Date(); const f = new Date(); f.setDate(t.getDate() - 90); return { from: f, to: t } } },
            ].map(({ label, fn }) => (
              <Button
                key={label}
                variant="outline"
                size="sm"
                onClick={() => { onDateChange(fn()); setIsOpen(false) }}
              >
                {label}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
