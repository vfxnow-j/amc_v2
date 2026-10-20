import 'dotenv/config'

const BASE = 'https://api.current-rms.com/api/v1'
const GAP_MS = 1100
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** GET-only Current RMS client. Paced ≥1.1 s per request; honours 429 Retry-After. Never logs the key. */
export function currentClient() {
  const sub = (process.env.CURRENT_RMS_SUBDOMAIN ?? '').replace(/["'\s]/g, '').replace(/^https?:\/\//, '').split('.')[0]
  const key = (process.env.CURRENT_RMS_API_KEY ?? '').replace(/["'\s]/g, '')
  if (!sub || !key) throw new Error('CURRENT_RMS_SUBDOMAIN / CURRENT_RMS_API_KEY not set')
  let count = 0
  let last = 0

  async function get(path: string): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const wait = last + GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      last = Date.now()
      count++
      const res = await fetch(`${BASE}/${path}`, { method: 'GET', headers: { 'X-SUBDOMAIN': sub, 'X-AUTH-TOKEN': key } })
      if (res.status === 429) {
        const s = Number(res.headers.get('retry-after')) || 15
        console.log(`  429 on ${path.split('?')[0]}; waiting ${s}s`)
        await sleep(s * 1000)
        continue
      }
      if (!res.ok) throw new Error(`Current ${res.status} on ${path.split('?')[0]}`)
      return (await res.json()) as Record<string, unknown>
    }
    throw new Error(`Current: gave up after 5 rate-limited attempts on ${path.split('?')[0]}`)
  }

  /**
   * Paged pull sorted by id (Current's default order is unstable across pages: repeats + gaps).
   * filtermode=all: list defaults hide records (opportunities 438 of 6,801; POs 372 of 375).
   */
  async function getAll(entity: string, key: string, query = '') {
    const byId = new Map<unknown, Record<string, unknown>>()
    let total = 0
    for (let page = 1; ; page++) {
      const j = await get(`${entity}?per_page=100&page=${page}&filtermode=all&q[s]=id+asc${query}`)
      const batch = (j[key] as Record<string, unknown>[]) ?? []
      for (const r of batch) byId.set(r.id, r)
      const meta = (j.meta ?? {}) as { total_row_count?: number; per_page?: number }
      total = meta.total_row_count ?? 0
      // Some endpoints cap per_page (opportunities: 25) — use the page size Current actually returned.
      if (!batch.length || page * (meta.per_page || batch.length) >= total) break
    }
    if (byId.size !== total) console.log(`  WARNING ${entity}: ${byId.size} unique of ${total} reported`)
    return [...byId.values()]
  }

  return { getAll, requests: () => count }
}
