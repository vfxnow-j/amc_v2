import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = {
  currentPage: number
  totalPages: number
  baseUrl: string
  searchParams?: Record<string, string | undefined>
}

export function Pagination({ currentPage, totalPages, baseUrl, searchParams = {} }: Props) {
  const buildUrl = (page: number) => {
    const params = new URLSearchParams()
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value) params.set(key, value)
    })
    params.set('page', page.toString())
    return `${baseUrl}?${params.toString()}`
  }

  // Calculate page range to show
  const getPageRange = () => {
    const range: number[] = []
    const maxVisible = 5 // Show max 5 page numbers

    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2))
    const end = Math.min(totalPages, start + maxVisible - 1)

    // Adjust start if end is at max
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1)
    }

    for (let i = start; i <= end; i++) {
      range.push(i)
    }

    return range
  }

  const pageRange = getPageRange()

  return (
    <nav className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        asChild
        disabled={currentPage <= 1}
        className={cn(currentPage <= 1 && 'pointer-events-none opacity-50')}
      >
        <Link href={buildUrl(currentPage - 1)}>
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">Previous page</span>
        </Link>
      </Button>

      {pageRange[0] > 1 && (
        <>
          <Button variant="outline" size="sm" asChild>
            <Link href={buildUrl(1)}>1</Link>
          </Button>
          {pageRange[0] > 2 && (
            <span className="px-2 text-muted-foreground">...</span>
          )}
        </>
      )}

      {pageRange.map((page) => (
        <Button
          key={page}
          variant={page === currentPage ? 'default' : 'outline'}
          size="sm"
          asChild={page !== currentPage}
          className={cn(page === currentPage && 'pointer-events-none')}
        >
          {page === currentPage ? (
            <span>{page}</span>
          ) : (
            <Link href={buildUrl(page)}>{page}</Link>
          )}
        </Button>
      ))}

      {pageRange[pageRange.length - 1] < totalPages && (
        <>
          {pageRange[pageRange.length - 1] < totalPages - 1 && (
            <span className="px-2 text-muted-foreground">...</span>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href={buildUrl(totalPages)}>{totalPages}</Link>
          </Button>
        </>
      )}

      <Button
        variant="outline"
        size="sm"
        asChild
        disabled={currentPage >= totalPages}
        className={cn(currentPage >= totalPages && 'pointer-events-none opacity-50')}
      >
        <Link href={buildUrl(currentPage + 1)}>
          <ChevronRight className="h-4 w-4" />
          <span className="sr-only">Next page</span>
        </Link>
      </Button>
    </nav>
  )
}
