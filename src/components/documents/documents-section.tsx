'use client'

import { useEffect, useState } from 'react'
import { Download, Trash2, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDocuments, deleteDocument } from '@/lib/actions/documents'
import { documentTypeLabels } from '@/lib/types'
import type { DocumentType } from '@/lib/types'
import { formatDateTime } from '@/lib/utils/format'
import Link from 'next/link'

type DocumentRecord = {
  id: string
  documentType: DocumentType
  filename: string
  fileSize: number
  isSigned: boolean
  signedBy: string | null
  createdAt: string
}

type Props = {
  entityType: string
  entityId: string
  showEmpty?: boolean
}

export function DocumentsSection({ entityType, entityId, showEmpty = false }: Props) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadDocuments = async () => {
    try {
      const docs = await getDocuments(entityType, entityId)
      setDocuments(docs as unknown as DocumentRecord[])
    } catch {
      // Silently fail - section just won't show
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDocuments()
  }, [entityType, entityId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteDocument(id)
      setDocuments((prev) => prev.filter((d) => d.id !== id))
      toast.success('Document deleted')
    } catch {
      toast.error('Failed to delete document')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    if (!showEmpty) return null
    return (
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Saved PDFs for this record</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }
  if (documents.length === 0) {
    if (!showEmpty) return null
    return (
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Saved PDFs for this record</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No documents for this asset
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>Saved PDFs for this record</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Filename</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Signed</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell>
                  <Badge variant="outline">
                    {documentTypeLabels[doc.documentType] || doc.documentType}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {doc.filename}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(doc.createdAt)}
                </TableCell>
                <TableCell>
                  {doc.isSigned ? (
                    <Badge variant="default">
                      Signed{doc.signedBy ? ` by ${doc.signedBy}` : ''}
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {doc.documentType === 'PROPOSAL' && entityType === 'RESERVATION' && (
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/dashboard/orders/${entityId}/proposal`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" asChild>
                      <a
                        href={`/api/documents/${doc.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(doc.id)}
                      disabled={deletingId === doc.id}
                    >
                      {deletingId === doc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 text-destructive" />
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
