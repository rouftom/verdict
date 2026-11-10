'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './button'
import { Select } from './select'

export interface DataTablePaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
  onPageChange: (page: number) => void
  onItemsPerPageChange: (items: number) => void
  /** Localised labels; defaults are the English console wording. */
  labels?: {
    rowsPerPage?: string
    range?: (from: number, to: number, total: number) => string
    page?: (current: number, total: number) => string
  }
  pageSizeOptions?: number[]
}

/**
 * Table footer copied from the FSM organisation console: rows-per-page picker
 * on the left, `from–to of total` in the middle, page chevrons on the right.
 */
export function DataTablePagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  labels,
  pageSizeOptions = [10, 20, 50, 100],
}: DataTablePaginationProps) {
  const safeTotalPages = Math.max(1, totalPages)
  const from = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1
  const to = Math.min(currentPage * itemsPerPage, totalItems)
  const rowsLabel = labels?.rowsPerPage ?? 'Rows per page'
  const range = labels?.range?.(from, to, totalItems) ?? `${from}–${to} of ${totalItems}`
  const pageLabel = labels?.page?.(currentPage, safeTotalPages) ?? `Page ${currentPage} of ${safeTotalPages}`

  return (
    <div className="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border bg-transparent px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="whitespace-nowrap text-[10px] font-normal text-muted-foreground">{rowsLabel}</span>
        <Select
          value={String(itemsPerPage)}
          onValueChange={(next) => onItemsPerPageChange(Number(next))}
          ariaLabel={rowsLabel}
          options={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
          className="w-16"
        />
      </div>

      <span className="order-last w-full text-center text-[10px] font-normal text-muted-foreground sm:order-none sm:w-auto sm:flex-1">
        {range}
      </span>

      <div className="flex shrink-0 items-center gap-1.5">
        <span className="hidden whitespace-nowrap text-[10px] font-normal text-muted-foreground sm:inline">{pageLabel}</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={currentPage >= safeTotalPages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
