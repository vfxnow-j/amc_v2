import { NextResponse } from 'next/server'

/**
 * The one error shape every /v1 route returns:
 *
 *   { "error": "<human sentence>", "code": "<machine code>", "details"?: … }
 *
 * `code` is what the portal branches on; `error` is for a person reading a
 * log. Success is always `{ "data": … }` (see `portalOk`).
 */
export type PortalErrorCode =
  | 'unauthorized'
  | 'forbidden_ip'
  | 'ip_unverifiable'
  | 'insufficient_scope'
  | 'rate_limited'
  | 'bad_request'
  | 'validation_failed'
  | 'not_found'
  | 'conflict'
  | 'rate_expired'
  | 'rate_mismatch'
  | 'idempotency_key_required'
  | 'idempotency_mismatch'
  | 'internal_error'

/** Throw from a handler; `withPortal` turns it into the response. */
export class PortalError extends Error {
  readonly status: number
  readonly code: PortalErrorCode
  readonly details?: unknown
  readonly headers?: Record<string, string>

  constructor(
    status: number,
    code: PortalErrorCode,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message)
    this.name = 'PortalError'
    this.status = status
    this.code = code
    this.details = options.details
    this.headers = options.headers
  }
}

export function portalError(
  status: number,
  code: PortalErrorCode,
  message: string,
  options: { details?: unknown; headers?: Record<string, string> } = {},
): NextResponse {
  const body: { error: string; code: PortalErrorCode; details?: unknown } = { error: message, code }
  if (options.details !== undefined) body.details = options.details
  return NextResponse.json(body, { status, headers: options.headers })
}

/** `{ data }` with the given status — plus `next_cursor` on a paged list. The only success shape. */
export function portalOk<T>(data: T, status = 200, headers?: Record<string, string>, nextCursor?: string | null): NextResponse {
  return NextResponse.json(nextCursor === undefined ? { data } : { data, next_cursor: nextCursor }, { status, headers })
}

export const notFound = (what = 'Not found') => new PortalError(404, 'not_found', what)
export const badRequest = (message: string, details?: unknown) =>
  new PortalError(400, 'bad_request', message, { details })

/**
 * Map anything thrown in a handler to the error shape. A PortalError keeps
 * its status and code; a zod error is a 422 with its issues (paths and
 * messages only, never the input); anything else is a 500 that says nothing
 * about internals.
 */
export function toPortalErrorResponse(error: unknown): NextResponse {
  if (error instanceof PortalError) {
    return portalError(error.status, error.code, error.message, {
      details: error.details,
      headers: error.headers,
    })
  }
  if (isZodError(error)) {
    return portalError(422, 'validation_failed', 'The request did not validate', {
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  return portalError(500, 'internal_error', 'Something went wrong on our side')
}

/**
 * `Cache-Control: no-store` on every response. A handler may return a
 * Response whose headers are immutable (e.g. `Response.redirect`, a fetched
 * response); that one is copied rather than letting the TypeError escape the
 * error handling and the request log.
 */
export function noStore(response: Response): Response {
  try {
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}

type ZodLike = { name: string; issues: { path: PropertyKey[]; message: string }[] }
function isZodError(error: unknown): error is ZodLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  )
}
