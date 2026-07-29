import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

const QB_CLIENT_ID = process.env.QB_CLIENT_ID || ''
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET || ''
const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI || ''
const QB_ENVIRONMENT = process.env.QB_ENVIRONMENT || 'sandbox'

const AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

export function getBaseUrl(): string {
  return QB_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'
}

export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function getOAuthUri(state: string): string {
  const params = new URLSearchParams({
    client_id: QB_CLIENT_ID,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: QB_REDIRECT_URI,
    state,
  })
  return `${AUTH_BASE}?${params.toString()}`
}

export async function handleCallback(code: string, realmId: string): Promise<void> {
  const credentials = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64')

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: QB_REDIRECT_URI,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to exchange code: ${error}`)
  }

  const tokens = await response.json()

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

  await prisma.qBToken.upsert({
    where: { id: 'qb-token' },
    create: {
      id: 'qb-token',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      realmId,
      expiresAt,
    },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      realmId,
      expiresAt,
    },
  })
}

async function refreshTokens(): Promise<{ accessToken: string; realmId: string }> {
  const stored = await prisma.qBToken.findUnique({ where: { id: 'qb-token' } })
  if (!stored) throw new Error('QuickBooks not connected')

  // If token hasn't expired, return it
  if (stored.expiresAt > new Date()) {
    return { accessToken: stored.accessToken, realmId: stored.realmId }
  }

  // Refresh the token
  const credentials = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64')

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to refresh token: ${error}`)
  }

  const tokens = await response.json()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

  await prisma.qBToken.update({
    where: { id: 'qb-token' },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    },
  })

  return { accessToken: tokens.access_token, realmId: stored.realmId }
}

export async function qbFetch(path: string, options: RequestInit = {}): Promise<any> {
  const { accessToken, realmId } = await refreshTokens()
  const baseUrl = getBaseUrl()
  const url = `${baseUrl}/v3/company/${realmId}${path}`

  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`QuickBooks API error (${response.status}): ${error}`)
  }

  return response.json()
}

export async function isConnected(): Promise<boolean> {
  try {
    const stored = await prisma.qBToken.findUnique({ where: { id: 'qb-token' } })
    return !!stored
  } catch {
    return false
  }
}

export async function getConnectionInfo(): Promise<{ connected: boolean; realmId?: string; expiresAt?: Date } | null> {
  try {
    const stored = await prisma.qBToken.findUnique({ where: { id: 'qb-token' } })
    if (!stored) return { connected: false }
    return {
      connected: true,
      realmId: stored.realmId,
      expiresAt: stored.expiresAt,
    }
  } catch {
    return { connected: false }
  }
}

export async function disconnect(): Promise<void> {
  const stored = await prisma.qBToken.findUnique({ where: { id: 'qb-token' } })
  if (!stored) return

  // Attempt to revoke the token
  try {
    const credentials = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64')
    await fetch('https://developer.api.intuit.com/v2/oauth2/tokens/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({ token: stored.refreshToken }),
    })
  } catch {
    // Revocation failure is non-critical
  }

  await prisma.qBToken.delete({ where: { id: 'qb-token' } })
}
