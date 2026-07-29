'use client'

import { useState } from 'react'
import { FileText, Truck, Printer, ClipboardList, ShieldCheck, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PDFViewerDialog } from './pdf-viewer-dialog'
import type { OrderDetailData } from './order-detail-pdf'
import type { PurchaseOrderData } from './purchase-order-pdf'
import type { InvoiceData } from './invoice-pdf'
import type { DocumentType, ReservationStatus } from '@/lib/types'
import { toast } from 'sonner'

type Props = {
  data: OrderDetailData | PurchaseOrderData
  entityType: string
  entityId: string
  reservationStatus?: ReservationStatus
  /** Supplying this enables the Pro Forma Invoice entry (sales orders today). */
  proFormaData?: InvoiceData
}

export function PrintDropdown({ data, entityType, entityId, reservationStatus, proFormaData }: Props) {
  const [selectedType, setSelectedType] = useState<DocumentType | null>(null)
  const isPO = entityType === 'PURCHASE_ORDER'

  const canPrintQuote = reservationStatus && !['DRAFT', 'REVISION'].includes(reservationStatus)

  const handleQuoteClick = () => {
    setSelectedType('QUOTE')
  }


  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setSelectedType(isPO ? 'PURCHASE_ORDER' : 'ORDER_DETAIL')}>
            <FileText className="mr-2 h-4 w-4" />
            {isPO ? 'Purchase Order' : 'Order Detail'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSelectedType('DELIVERY_NOTE')}>
            <Truck className="mr-2 h-4 w-4" />
            Delivery Note
          </DropdownMenuItem>
          {!isPO && canPrintQuote && (
            <DropdownMenuItem onClick={handleQuoteClick}>
              <ClipboardList className="mr-2 h-4 w-4" />
              Quote
            </DropdownMenuItem>
          )}
          {proFormaData && (
            <DropdownMenuItem onClick={() => setSelectedType('PRO_FORMA')}>
              <Receipt className="mr-2 h-4 w-4" />
              Pro Forma Invoice
            </DropdownMenuItem>
          )}
          {!isPO && (
            <DropdownMenuItem onClick={async () => {
              try {
                const { getAgreementTemplate } = await import('@/lib/actions/agreement')
                const template = await getAgreementTemplate()
                if (!template) {
                  toast.error('No rental agreement template uploaded. Go to Settings > Documents to upload one.')
                  return
                }
                window.open('/api/agreement-template', '_blank')
              } catch {
                toast.error('Failed to load rental agreement')
              }
            }}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              Rental Agreement
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedType && (
        <PDFViewerDialog
          open={!!selectedType}
          onOpenChange={(open) => {
            if (!open) setSelectedType(null)
          }}
          documentType={selectedType}
          data={selectedType === 'PRO_FORMA' && proFormaData ? proFormaData : data}
          entityType={entityType}
          entityId={entityId}
        />
      )}
    </>
  )
}
