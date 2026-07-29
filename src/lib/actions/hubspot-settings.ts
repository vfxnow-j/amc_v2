'use server'

import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'

const KEYS = {
  accessToken: 'hubspot_access_token',
  webhookSecret: 'hubspot_webhook_secret',
  enabled: 'hubspot_enabled',
  pipelineRental: 'hubspot_pipeline_rental',
  pipelineSale: 'hubspot_pipeline_sale',
  pipelineRTO: 'hubspot_pipeline_rto',
  pipelineCloud: 'hubspot_pipeline_cloud',
} as const

export type HubSpotSettings = {
  accessToken: string
  webhookSecret: string
  enabled: boolean
  pipelineRental: string
  pipelineSale: string
  pipelineRTO: string
  pipelineCloud: string
}

export async function getHubSpotSettings(): Promise<HubSpotSettings> {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(KEYS) } },
  })

  const map = new Map(rows.map((r) => [r.key, r.value]))

  return {
    accessToken: (map.get(KEYS.accessToken) as string) || '',
    webhookSecret: (map.get(KEYS.webhookSecret) as string) || '',
    enabled: map.get(KEYS.enabled) === true,
    pipelineRental: (map.get(KEYS.pipelineRental) as string) || 'default',
    pipelineSale: (map.get(KEYS.pipelineSale) as string) || 'default',
    pipelineRTO: (map.get(KEYS.pipelineRTO) as string) || 'default',
    pipelineCloud: (map.get(KEYS.pipelineCloud) as string) || 'default',
  }
}

export async function saveHubSpotSettings(data: {
  accessToken: string
  webhookSecret: string
  enabled: boolean
  pipelineRental: string
  pipelineSale: string
  pipelineRTO: string
  pipelineCloud: string
}) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const pairs: [string, string | boolean][] = [
    [KEYS.accessToken, data.accessToken],
    [KEYS.webhookSecret, data.webhookSecret],
    [KEYS.enabled, data.enabled],
    [KEYS.pipelineRental, data.pipelineRental],
    [KEYS.pipelineSale, data.pipelineSale],
    [KEYS.pipelineRTO, data.pipelineRTO],
    [KEYS.pipelineCloud, data.pipelineCloud],
  ]

  for (const [key, value] of pairs) {
    const jsonValue = value as any
    await prisma.setting.upsert({
      where: { key },
      update: { value: jsonValue },
      create: { key, value: jsonValue },
    })
  }

  return { success: true }
}

/**
 * Fetch available pipelines from HubSpot for the dropdown.
 */
export async function fetchHubSpotPipelines(): Promise<{ id: string; label: string }[]> {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const tokenRow = await prisma.setting.findUnique({ where: { key: KEYS.accessToken } })
  const token = tokenRow?.value as string | null
  if (!token) throw new Error('HubSpot access token not configured')

  const response = await fetch('https://api.hubapi.com/crm/v3/pipelines/deals', {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HubSpot API error: ${response.status} ${text}`)
  }

  const data = await response.json()
  return (data.results || []).map((p: any) => ({
    id: p.id,
    label: p.label,
  }))
}
