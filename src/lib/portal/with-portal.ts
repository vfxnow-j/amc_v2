import type { NextRequest } from 'next/server'
import { authorizePortal, type PortalPrincipal, type PortalScope } from './auth'
import { PortalError, noStore, toPortalErrorResponse } from './errors'
import { logPortalRequest } from './request-log'

/**
 * The wrapper every /v1 route handler goes through, so they are uniform:
 * authorize (token, CIDR, scope, rate limit) → run → map thrown errors to the
 * one error shape → log one request row. Handlers return a Response (use
 * `portalOk`) or throw a PortalError / zod error.
 *
 *   export const GET = withPortal('portal:read', async (req, { portal, params }) => …)
 */
export type PortalHandlerContext<P> = {
  portal: PortalPrincipal
  params: P
  /** Record which account the request was about, for the request log. */
  setAccountId: (accountId: string) => void
}

export type PortalHandler<P> = (req: NextRequest, ctx: PortalHandlerContext<P>) => Promise<Response>

export function withPortal<P extends Record<string, string | string[] | undefined> = Record<string, never>>(
  scope: PortalScope,
  handler: PortalHandler<P>,
) {
  return async function portalRoute(req: NextRequest, route: { params: Promise<P> }): Promise<Response> {
    const started = performance.now()
    let portalClientId: string | null = null
    let accountId: string | null = null
    let response: Response

    try {
      const auth = await authorizePortal(req, scope)
      if (!auth.ok) {
        portalClientId = auth.portalClientId ?? null
        response = auth.response
      } else {
        portalClientId = auth.portal.id
        const params = (await route?.params) ?? ({} as P)
        response = await handler(req, {
          portal: auth.portal,
          params,
          setAccountId: (id) => {
            accountId = id
          },
        })
      }
      response = noStore(response)
    } catch (error) {
      if (!(error instanceof PortalError) && !isZod(error)) {
        console.error(`[portal] ${req.method} ${req.nextUrl?.pathname ?? ''} failed:`, error)
      }
      response = noStore(toPortalErrorResponse(error))
    }

    logPortalRequest({
      method: req.method,
      path: req.nextUrl?.pathname ?? new URL(req.url).pathname,
      status: response.status,
      ms: performance.now() - started,
      portalClientId,
      accountId,
    })
    return response
  }
}

function isZod(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'ZodError'
}
