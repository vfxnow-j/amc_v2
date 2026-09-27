/**
 * The portal's way in over WireGuard: a relay on the tunnel address that tells
 * v2 who is really calling (docs/portal-api.md; src/lib/portal/auth-core.ts).
 *
 * Next's route handlers can't see the TCP socket, and Next only fills
 * x-forwarded-for when a caller hasn't, so no header a caller can reach is
 * trustworthy on its own. This relay listens ONLY on the tunnel address, drops
 * any address or stamp headers the caller sent, writes the socket's address to
 * x-real-ip and stamps x-portal-relay with PORTAL_RELAY_SECRET, then forwards
 * to the app. v2 trusts the address only when the stamp matches.
 *
 * Only /v1/ is forwarded — nothing else of v2 is reachable through the tunnel.
 * Bodies are streamed, never read or logged.
 *
 *   node scripts/portal-relay.mjs
 *   env: PORTAL_RELAY_SECRET (from .env), RELAY_LISTEN (default 10.8.0.2:3002),
 *        RELAY_TARGET (default 127.0.0.1:3001)
 *
 * Stand-in until hosting puts a real reverse proxy in front of v2.
 */
import 'dotenv/config'
import http from 'node:http'

const secret = process.env.PORTAL_RELAY_SECRET?.trim()
if (!secret || secret.length < 32) {
  console.error('[relay] PORTAL_RELAY_SECRET is missing or shorter than 32 characters.')
  process.exit(1)
}
const [listenHost, listenPort] = (process.env.RELAY_LISTEN ?? '10.8.0.2:3002').split(':')
const [targetHost, targetPort] = (process.env.RELAY_TARGET ?? '127.0.0.1:3001').split(':')

const DROP = new Set(['x-real-ip', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-portal-relay', 'forwarded'])

const server = http.createServer((req, res) => {
  const started = Date.now()
  const path = req.url ?? '/'
  if (!path.startsWith('/v1/')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found', code: 'not_found' }))
    return
  }
  const headers = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (!DROP.has(name)) headers[name] = value
  }
  headers['x-real-ip'] = req.socket.remoteAddress ?? ''
  headers['x-portal-relay'] = secret
  headers.host = `${targetHost}:${targetPort}`

  const upstream = http.request(
    { host: targetHost, port: Number(targetPort), method: req.method, path, headers },
    (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers)
      reply.pipe(res)
      reply.on('end', () =>
        console.log(`[relay] ${req.socket.remoteAddress} ${req.method} ${path.split('?')[0]} ${reply.statusCode} ${Date.now() - started}ms`),
      )
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'AMC is not answering', code: 'internal_error' }))
  })
  req.pipe(upstream)
})

server.listen(Number(listenPort), listenHost, () => {
  console.log(`[relay] ${listenHost}:${listenPort} → ${targetHost}:${targetPort} (/v1/ only)`)
})
