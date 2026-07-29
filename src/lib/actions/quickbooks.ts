'use server'

import { requireAdmin, requireAuth } from '@/lib/auth-utils'
import {
  getConnectionInfo as _getConnectionInfo,
  isConnected as _isConnected,
} from '@/lib/quickbooks/qb-client'
import {
  getSyncStatus as _getSyncStatus,
  syncAllCustomers as _syncAllCustomers,
  syncAllInvoices as _syncAllInvoices,
  syncCustomerToQB as _syncCustomerToQB,
  syncInvoiceToQB as _syncInvoiceToQB,
  syncPaymentToQB as _syncPaymentToQB,
} from '@/lib/quickbooks/qb-sync'

// Read-only functions - requireAuth()

export async function getConnectionInfo() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  return _getConnectionInfo()
}

export async function isConnected() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  return _isConnected()
}

export async function getSyncStatus() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  return _getSyncStatus()
}

// Mutation functions - requireAdmin()

export async function syncAllCustomers() {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)
  return _syncAllCustomers()
}

export async function syncAllInvoices() {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)
  return _syncAllInvoices()
}

export async function syncCustomerToQB(clientId: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)
  return _syncCustomerToQB(clientId)
}

export async function syncInvoiceToQB(invoiceId: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)
  return _syncInvoiceToQB(invoiceId)
}

export async function syncPaymentToQB(paymentId: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)
  return _syncPaymentToQB(paymentId)
}
