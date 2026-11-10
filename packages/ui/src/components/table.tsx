import * as React from 'react'
import { cn } from '../lib/cn'

/**
 * Table primitives styled like the FSM admin tables: a soft header band
 * (`bg-muted/60`), sentence-case column
 * labels, and hairline dividers. The console uses these everywhere it renders rows.
 */
export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="custom-scrollbar w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full caption-bottom text-left text-[11px]', className)} {...props} />
    </div>
  )
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      className={cn('bg-muted/60', className)}
      {...props}
    />
  )
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('divide-y divide-border', className)} {...props} />
}

export function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return <tfoot className={cn('border-t border-border', className)} {...props} />
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn('group/row border-border transition-colors hover:bg-brand-primary/5', className)}
      {...props}
    />
  )
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-4 py-3 text-[11px] font-medium text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-4 py-2.5 align-middle text-foreground', className)} {...props} />
}

export function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption className={cn('mt-2 text-[10px] text-muted-foreground', className)} {...props} />
  )
}
