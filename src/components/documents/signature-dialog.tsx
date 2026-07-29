'use client'

import { useRef, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (signerName: string, signatureDataUrl: string) => void
}

export function SignatureDialog({ open, onOpenChange, onConfirm }: Props) {
  const sigRef = useRef<SignatureCanvas>(null)
  const [signerName, setSignerName] = useState('')

  const handleClear = () => {
    sigRef.current?.clear()
  }

  const handleConfirm = () => {
    if (!signerName.trim()) return
    if (!sigRef.current || sigRef.current.isEmpty()) return

    const dataUrl = sigRef.current.getTrimmedCanvas().toDataURL('image/png')
    onConfirm(signerName.trim(), dataUrl)
    setSignerName('')
    sigRef.current?.clear()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign Delivery Note</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Signer Name
            </label>
            <Input
              placeholder="Full name..."
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Signature
            </label>
            <div className="border rounded-md bg-white overflow-hidden">
              <SignatureCanvas
                ref={sigRef}
                canvasProps={{
                  width: 400,
                  height: 150,
                  className: 'w-full',
                  style: { width: '100%', height: 150 },
                }}
                backgroundColor="white"
                penColor="black"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClear}>
            Clear
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!signerName.trim()}
          >
            Confirm Signature
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
