/**
 * The Content-Security-Policy, built per request so each page render gets its
 * own nonce (next/docs "Content Security Policy"). Pages that render without a
 * request — static assets — carry no nonce and need none.
 *
 * Scripts are the part that matters: a nonce plus `strict-dynamic` means only
 * the scripts Next itself emitted (and what they load) run, so an injected
 * `<script>` or an `onerror=` handler does nothing. Styles keep
 * `'unsafe-inline'` because components set `style=` attributes all over the
 * app and a nonce cannot cover attributes; an injected style can restyle a
 * page but cannot run code.
 *
 * The one outside origin is the map's tile server (inventory map). Anything
 * else the app talks to — QuickBooks, HubSpot, Resend — is called from the
 * server, never from the browser.
 */

const TILES = "https://tiles.openfreemap.org";

export function buildCsp(nonce: string, { dev = false } = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${TILES}`,
    "font-src 'self' data:",
    `connect-src 'self' ${TILES}`,
    // maplibre runs its tile decoding in a blob: worker.
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    // The PDF viewer and report previews frame our own routes.
    "frame-src 'self' blob:",
    "object-src 'self' blob:",
    // The barcode scanner reads the camera into a blob: stream.
    "media-src 'self' blob:",
    "base-uri 'self'",
    "form-action 'self'",
    // Matches X-Frame-Options: SAMEORIGIN.
    "frame-ancestors 'self'",
    "report-uri /api/csp-report",
  ].join("; ");
}

/** `report-only` until the logs show nothing legitimate being blocked. */
export function cspHeaderName(): string {
  return process.env.CSP_MODE === "enforce"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
}
