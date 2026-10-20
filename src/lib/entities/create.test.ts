import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEntityRecord, type EntityRegistry } from './create'
import type { EntityData } from './entity-input'

const data = { name: 'Acme Studios', slug: 'acme-studios', modules: ['INVENTORY'] } as unknown as EntityData

function harness(opts: { taken?: boolean; provision?: () => Promise<{ version: number }>; create?: () => Promise<{ id: string }>; drop?: () => Promise<void> } = {}) {
  const calls = { provision: [] as string[], drop: [] as string[], create: 0, row: null as null | { schemaVersion: number; dbName: string } }
  const registry: EntityRegistry = {
    slugTaken: async () => opts.taken ?? false,
    create: async (row) => { calls.create++; calls.row = row; return (opts.create ?? (async () => ({ id: 'e1' })))() },
  }
  const provision = (async (db: string) => { calls.provision.push(db); return (opts.provision ?? (async () => ({ version: 3 })))() }) as never
  const drop = (async (db: string) => { calls.drop.push(db); return (opts.drop ?? (async () => {}))() }) as never
  return { calls, run: () => createEntityRecord(registry, data, provision, drop) }
}

test('a taken slug provisions nothing', async () => {
  const h = harness({ taken: true })
  const r = await h.run()
  assert.equal(r.status, 'error')
  assert.deepEqual(h.calls.provision, [])
  assert.equal(h.calls.create, 0)
})

for (const message of ['boom', 'database "vfxnow_ent_acme_studios" already exists']) {
  test(`provisioning that throws (${message.slice(0, 12)}…) drops nothing and writes no registry row`, async () => {
    const h = harness({ provision: async () => { throw new Error(message) } })
    const r = await h.run()
    assert.equal(r.status, 'error')
    assert.deepEqual(h.calls.drop, [])
    assert.equal(h.calls.create, 0)
  })
}

test('a failed registry write drops that database exactly once', async () => {
  const h = harness({ create: async () => { throw new Error('unique violation') } })
  const r = await h.run()
  assert.equal(r.status, 'error')
  assert.deepEqual(h.calls.drop, ['vfxnow_ent_acme_studios'])
})

test('if the drop also fails, the error names the orphaned database', async () => {
  const h = harness({ create: async () => { throw new Error('x') }, drop: async () => { throw new Error('cannot drop') } })
  const r = await h.run()
  assert.equal(r.status, 'error')
  assert.match((r as { message: string }).message, /vfxnow_ent_acme_studios/)
  assert.deepEqual(h.calls.drop, ['vfxnow_ent_acme_studios'])
})

test('success returns the created entity', async () => {
  const h = harness()
  const r = await h.run()
  assert.deepEqual(r, { status: 'ok', id: 'e1', slug: 'acme-studios', dbName: 'vfxnow_ent_acme_studios' })
  assert.deepEqual(h.calls.drop, [])
  assert.equal(h.calls.row?.schemaVersion, 3)
  assert.equal(h.calls.row?.dbName, 'vfxnow_ent_acme_studios')
})
