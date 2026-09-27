import { portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'

/**
 * GET /v1/health — proves the stack end to end: rewrite, token, CIDR, scope,
 * rate limit, request log. Says only who the caller is.
 */
export const GET = withPortal('portal:read', async (_req, { portal }) =>
  portalOk({ ok: true, portal: portal.name }),
)
