'use client'

import { useCallback, useEffect, useState } from 'react'
import { pdf } from '@react-pdf/renderer'
import { Printer, Download, Save, PenTool, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { OrderDetailPDF, type OrderDetailData } from './order-detail-pdf'
import { PurchaseOrderPDF, type PurchaseOrderData } from './purchase-order-pdf'
import { DeliveryNotePDF } from './delivery-note-pdf'
import { InvoicePDF, type InvoiceData } from './invoice-pdf'
import { QuotePDF } from './quote-pdf'
import { SignatureDialog } from './signature-dialog'
import { getLogoDataUri } from '@/lib/utils/logo'
import { saveDocument, signDocument } from '@/lib/actions/documents'
import type { DocumentType } from '@/lib/types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentType: DocumentType
  data: OrderDetailData | PurchaseOrderData | InvoiceData
  entityType: string
  entityId: string
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ').trim()
}

async function blobToBase64(b: Blob): Promise<string> {
  const buffer = await b.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function buildFilename(documentType: DocumentType, data: OrderDetailData | PurchaseOrderData | InvoiceData, signed?: boolean): string {
  let name = ''
  let number = ''

  if (documentType === 'PURCHASE_ORDER') {
    const po = data as PurchaseOrderData
    name = po.vendorName
    number = po.number
  } else if (documentType === 'INVOICE' || documentType === 'PRO_FORMA') {
    const inv = data as InvoiceData
    name = inv.clientCompany || inv.clientName
    number = inv.invoiceNumber
  } else {
    // ORDER_DETAIL, QUOTE, DELIVERY_NOTE — all use OrderDetailData
    const od = data as OrderDetailData
    name = od.contactCompany || od.contactName
    number = od.number
  }

  const suffix = signed ? '-signed' : ''
  return `${sanitizeFilename(name)}-${sanitizeFilename(number)}${suffix}.pdf`
}

export function PDFViewerDialog({
  open,
  onOpenChange,
  documentType,
  data,
  entityType,
  entityId,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showSignature, setShowSignature] = useState(false)
  const [savedDocumentId, setSavedDocumentId] = useState<string | null>(null)
  const [signatureData, setSignatureData] = useState<{
    signerName: string
    signatureDataUrl: string
  } | null>(null)

  const generatePdf = useCallback(async (
    sigData?: { signerName: string; signatureDataUrl: string }
  ) => {
    setIsGenerating(true)
    try {
      const logoDataUri = await getLogoDataUri()

      let doc: React.ReactElement
      if (documentType === 'INVOICE' || documentType === 'PRO_FORMA') {
        doc = (
          <InvoicePDF
            data={data as InvoiceData}
            logoDataUri={logoDataUri}
            proForma={documentType === 'PRO_FORMA'}
          />
        )
      } else if (documentType === 'PURCHASE_ORDER') {
        doc = <PurchaseOrderPDF data={data as PurchaseOrderData} logoDataUri={logoDataUri} />
      } else if (documentType === 'ORDER_DETAIL') {
        doc = <OrderDetailPDF data={data as OrderDetailData} logoDataUri={logoDataUri} />
      } else if (documentType === 'QUOTE') {
        doc = <QuotePDF data={data as OrderDetailData} logoDataUri={logoDataUri} />
      } else {
        doc = (
          <DeliveryNotePDF
            data={data as OrderDetailData}
            logoDataUri={logoDataUri}
            signatureDataUrl={sigData?.signatureDataUrl}
            signerName={sigData?.signerName}
            signedAt={sigData ? new Date().toLocaleString() : undefined}
          />
        )
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfBlob = await pdf(doc as any).toBlob()
      const url = URL.createObjectURL(pdfBlob)

      // Clean up previous URL
      if (blobUrl) URL.revokeObjectURL(blobUrl)

      setBlob(pdfBlob)
      setBlobUrl(url)
    } catch (error) {
      console.error('PDF generation failed:', error)
      toast.error('Failed to generate PDF')
    } finally {
      setIsGenerating(false)
    }
  }, [documentType, data, blobUrl])

  useEffect(() => {
    if (open) {
      setSavedDocumentId(null)
      setSignatureData(null)
      generatePdf()
    }
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrint = () => {
    if (!blobUrl) return
    const printWindow = window.open(blobUrl, '_blank')
    if (printWindow) {
      printWindow.addEventListener('load', () => {
        printWindow.print()
      })
    }
  }

  const handleDownload = () => {
    if (!blobUrl) return
    const filename = buildFilename(documentType, data, !!signatureData)

    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleSave = async () => {
    if (!blob) return
    setIsSaving(true)
    try {
      const base64 = await blobToBase64(blob)

      const filename = buildFilename(documentType, data, !!signatureData)

      // Map QUOTE to PROPOSAL for Prisma storage
      const storageType = documentType === 'QUOTE' ? 'PROPOSAL' : documentType

      const result = await saveDocument({
        documentType: storageType as any,
        entityType,
        entityId,
        pdfBase64: base64,
        filename,
      })

      setSavedDocumentId(result.id)
      toast.success('Document saved')
    } catch (error) {
      console.error('Save failed:', error)
      toast.error('Failed to save document')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSignConfirm = async (signerName: string, signatureDataUrl: string) => {
    const sigData = { signerName, signatureDataUrl }
    setSignatureData(sigData)

    // Render the signed PDF (returns the blob inline so we don't race state).
    // Signing is only exposed for delivery notes today.
    setIsGenerating(true)
    let signedBlob: Blob | null = null
    try {
      const logoDataUri = await getLogoDataUri()
      const doc = (
        <DeliveryNotePDF
          data={data as OrderDetailData}
          logoDataUri={logoDataUri}
          signatureDataUrl={sigData.signatureDataUrl}
          signerName={sigData.signerName}
          signedAt={new Date().toLocaleString()}
        />
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signedBlob = await pdf(doc as any).toBlob()
      const url = URL.createObjectURL(signedBlob)
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      setBlob(signedBlob)
      setBlobUrl(url)
    } catch (error) {
      console.error('Signed PDF generation failed:', error)
      toast.error('Failed to generate signed PDF')
      setIsGenerating(false)
      return
    } finally {
      setIsGenerating(false)
    }

    // Always persist signed documents — without this the signature is lost on close.
    setIsSaving(true)
    try {
      const base64 = await blobToBase64(signedBlob)
      const filename = buildFilename(documentType, data, true)
      const storageType = documentType === 'QUOTE' ? 'PROPOSAL' : documentType

      if (savedDocumentId) {
        await signDocument(savedDocumentId, base64, signerName)
      } else {
        const result = await saveDocument({
          documentType: storageType as any,
          entityType,
          entityId,
          pdfBase64: base64,
          filename,
        })
        setSavedDocumentId(result.id)
        // Stamp signature metadata on the freshly-created record
        await signDocument(result.id, base64, signerName)
      }
      toast.success('Signed document saved')
    } catch (error) {
      console.error('Sign-and-save failed:', error)
      toast.error('Failed to save signed document — try Save to Documents')
    } finally {
      setIsSaving(false)
    }
  }

  const isDeliveryNote = documentType === 'DELIVERY_NOTE'
  const titleMap: Record<string, string> = { ORDER_DETAIL: 'Order Detail', PURCHASE_ORDER: 'Purchase Order', INVOICE: 'Invoice', PRO_FORMA: 'Pro Forma Invoice', DELIVERY_NOTE: 'Delivery Note', QUOTE: 'Quote' }
  const title = titleMap[documentType] || 'Document'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle>{title} - {'number' in data ? data.number : (data as InvoiceData).invoiceNumber}</DialogTitle>
          </DialogHeader>

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-6 pb-2 border-b">
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={!blobUrl}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={!blobUrl}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={!blob || isSaving}
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save to Documents
            </Button>
            {isDeliveryNote && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSignature(true)}
                disabled={!blobUrl}
              >
                <PenTool className="mr-2 h-4 w-4" />
                Sign
              </Button>
            )}
            {signatureData && (
              <span className="text-xs text-green-600 font-medium ml-2">
                Signed by {signatureData.signerName}
              </span>
            )}
          </div>

          {/* PDF Viewer */}
          <div className="flex-1 px-6 pb-6">
            {isGenerating ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Generating PDF...</span>
              </div>
            ) : blobUrl ? (
              <iframe
                src={blobUrl}
                className="w-full h-full rounded border"
                title={`${title} Preview`}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Failed to generate PDF
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <SignatureDialog
        open={showSignature}
        onOpenChange={setShowSignature}
        onConfirm={handleSignConfirm}
      />
    </>
  )
}
