'use server'

import { requireAdmin } from '@/lib/auth-utils'
import {
  getWebhookSecret as _getWebhookSecret,
  generateWebhookSecret as _generateWebhookSecret,
} from '@/lib/integrations/zapier'

export async function getZapierWebhookSecret() {
  const authResult = await requireAdmin()
  if (!authResult.authorized) return null
  return _getWebhookSecret()
}

export async function generateZapierWebhookSecret() {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error('Unauthorized')
  return _generateWebhookSecret()
}
