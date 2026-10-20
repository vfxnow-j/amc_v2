import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCloudOrderItems,
  cloudHostDescription,
  cloudSpecLine,
  parseHostName,
  priceCloudEnv,
  priceCloudHost,
  totalsByPeriod,
  type CloudProductRow,
} from './host'

function product(id: string, category: string, name: string, costMonthly: number, extra: Partial<CloudProductRow> = {}): CloudProductRow {
  return {
    id, category, name,
    costHourly: costMonthly / 720, costDaily: costMonthly / 30, costWeekly: costMonthly / 4, costMonthly,
    sellHourly: null, sellDaily: null, sellWeekly: null, sellMonthly: null,
    marginPercent: 25,
    ...extra,
  }
}

const P = [
  product('cpu24', 'HOST_CPU', '24C', 325),
  product('ram96', 'HOST_RAM', '96GB', 60),
  product('ssd512', 'HOST_STORAGE', '512GB', 5),
  product('ssd4t', 'HOST_STORAGE', '4TB', 40),
  product('gpu', 'HOST_GRAPHICS', 'RTX 4090', 275),
  product('net', 'HOST_NETWORKING', '10G', 20),
  product('inet', 'ENV_INTERNET', '1G', 1000, { sellMonthly: 1200 }),
  product('dom', 'ENV_ADDON', 'Domain', 50),
]

test('the spec line reads CPU / RAM / drives / GPUs / network, whatever order they were picked in', () => {
  const line = cloudSpecLine([
    { category: 'HOST_GRAPHICS', productName: 'RTX 4090', qtyPerHost: 2 },
    { category: 'HOST_STORAGE', productName: '512GB', qtyPerHost: 1 },
    { category: 'HOST_RAM', productName: '96GB', qtyPerHost: 1 },
    { category: 'HOST_CPU', productName: '24C', qtyPerHost: 1 },
  ])
  assert.equal(line, '24C / 96GB RAM / 512GB SSD / 2x RTX 4090')
})

test('a named host leads with its tag, an unnamed one says what it is', () => {
  const parts = [{ category: 'HOST_CPU', productName: '32C', qtyPerHost: 1 }]
  assert.equal(cloudHostDescription(parts, 'HP-VM'), '[HP-VM] 32C')
  assert.equal(cloudHostDescription(parts), 'Cloud host · 32C')
  assert.equal(parseHostName('[HP-VM] 32C / 96GB RAM'), 'HP-VM')
  assert.equal(parseHostName('Cloud host · 32C'), null)
  assert.equal(parseHostName(null), null)
  // Brackets in a typed name would break the round trip.
  assert.equal(cloudHostDescription(parts, '[a]'), '[a] 32C')
})

test('a host is priced from cost and margin, per host, and multiplied by the host count', () => {
  const host = priceCloudHost(P, {
    period: 'MONTHLY', quantity: 3,
    rows: [
      { cloudProductId: 'ram96', qtyPerHost: 1 },
      { cloudProductId: 'cpu24', qtyPerHost: 1 },
      { cloudProductId: 'gpu', qtyPerHost: 2 },
    ],
  })
  // cpu 325*1.25 = 406.25, ram 75, 2 gpu = 2 * 343.75
  assert.equal(host.perHostSell, 406.25 + 75 + 687.5)
  assert.equal(host.perHostCost, 325 + 60 + 550)
  assert.equal(host.totalSell, host.perHostSell * 3)
  assert.deepEqual(host.components.map((c) => c.categoryLabel), ['CPU', 'RAM', 'GPU'])
  assert.equal(host.description, 'Cloud host · 24C / 96GB RAM / 2x RTX 4090')
})

test('a margin override recomputes every part from cost', () => {
  const host = priceCloudHost(P, {
    period: 'MONTHLY', quantity: 1, marginOverride: 50,
    rows: [{ cloudProductId: 'cpu24', qtyPerHost: 1 }, { cloudProductId: 'ram96', qtyPerHost: 1 }],
  })
  assert.equal(host.perHostSell, 487.5 + 90)
  // A negative or absurd override is ignored rather than stored.
  const ignored = priceCloudHost(P, {
    period: 'MONTHLY', quantity: 1, marginOverride: -5,
    rows: [{ cloudProductId: 'cpu24', qtyPerHost: 1 }, { cloudProductId: 'ram96', qtyPerHost: 1 }],
  })
  assert.equal(ignored.marginOverride, null)
  assert.equal(ignored.perHostSell, 406.25 + 75)
})

test('a product with a sell override beats its margin', () => {
  const env = priceCloudEnv(P, { cloudProductId: 'inet', quantity: 1 })
  assert.equal(env.rate, 1200)
  assert.equal(env.description, 'Internet: 1G')
  assert.equal(env.category, 'Cloud · Internet')
})

test('a host needs a CPU and RAM, at least one host, and products that exist', () => {
  assert.throws(() => priceCloudHost(P, { period: 'MONTHLY', quantity: 1, rows: [{ cloudProductId: 'ram96', qtyPerHost: 1 }] }), /CPU/)
  assert.throws(() => priceCloudHost(P, { period: 'MONTHLY', quantity: 1, rows: [{ cloudProductId: 'cpu24', qtyPerHost: 1 }] }), /RAM/)
  assert.throws(() => priceCloudHost(P, { period: 'MONTHLY', quantity: 0, rows: [] }), /at least one host/)
  assert.throws(() => priceCloudHost(P, { period: 'MONTHLY', quantity: 1, rows: [{ cloudProductId: 'nope', qtyPerHost: 1 }] }), /catalogue/)
  // An environment product is not a host part, and the reverse.
  assert.throws(() => priceCloudHost(P, { period: 'MONTHLY', quantity: 1, rows: [{ cloudProductId: 'inet', qtyPerHost: 1 }] }), /catalogue/)
  assert.throws(() => priceCloudEnv(P, { cloudProductId: 'cpu24', quantity: 1 }), /catalogue/)
})

test('other periods price off that period\'s cost', () => {
  const host = priceCloudHost(P, {
    period: 'DAILY', quantity: 1,
    rows: [{ cloudProductId: 'cpu24', qtyPerHost: 1 }, { cloudProductId: 'ram96', qtyPerHost: 1 }],
  })
  assert.equal(host.perHostSell, Math.round((325 / 30) * 1.25 * 100) / 100 + Math.round((60 / 30) * 1.25 * 100) / 100)
})

test('order rows: the host carries the money, its parts carry none, the environment follows', () => {
  const rows = buildCloudOrderItems(
    P,
    [{ period: 'MONTHLY', quantity: 2, hostName: 'HP-VM', rows: [{ cloudProductId: 'cpu24', qtyPerHost: 1 }, { cloudProductId: 'ram96', qtyPerHost: 1 }, { cloudProductId: 'ssd512', qtyPerHost: 2 }] }],
    [{ cloudProductId: 'dom', quantity: 1 }],
  )
  assert.equal(rows.length, 1 + 3 + 1)
  const [host, ...rest] = rows
  assert.equal(host.parentUid, null)
  assert.equal(host.quantity, 2)
  assert.equal(host.category, 'Cloud')
  assert.equal(host.description, '[HP-VM] 24C / 96GB RAM / 2x 512GB SSD')
  const parts = rest.slice(0, 3)
  assert.ok(parts.every((p) => p.parentUid === host.uid && p.rate === 0 && p.cloudProductId))
  assert.deepEqual(parts.map((p) => p.description), ['CPU: 24C', 'RAM: 96GB', 'Storage: 512GB'])
  assert.equal(parts[2].quantity, 2)
  const env = rest[3]
  assert.equal(env.parentUid, null)
  assert.equal(env.cloudProductId, 'dom')
  assert.equal(env.rate, 62.5)
  assert.equal(new Set(rows.map((r) => r.uid)).size, rows.length)
})

test('totals group by billing period', () => {
  assert.deepEqual(
    totalsByPeriod([
      { period: 'MONTHLY', amount: 100.1 },
      { period: 'DAILY', amount: 5 },
      { period: 'MONTHLY', amount: 0.2 },
    ]),
    [{ period: 'DAILY', amount: 5 }, { period: 'MONTHLY', amount: 100.3 }],
  )
})

test('a draft totals hosts and environment together, or says what is wrong', async () => {
  const { cloudDraftTotals } = await import('./host')
  const ok = cloudDraftTotals(
    P,
    [{ period: 'MONTHLY', quantity: 2, rows: [{ cloudProductId: 'cpu24', qtyPerHost: 1 }, { cloudProductId: 'ram96', qtyPerHost: 1 }] }],
    [{ cloudProductId: 'inet', quantity: 1 }],
  )
  assert.equal(ok.problem, null)
  assert.deepEqual(ok.byPeriod, [{ period: 'MONTHLY', amount: (406.25 + 75) * 2 + 1200 }])
  const bad = cloudDraftTotals(P, [{ period: 'MONTHLY', quantity: 1, rows: [] }], [])
  assert.match(bad.problem ?? '', /CPU/)
  assert.deepEqual(bad.byPeriod, [])
})
