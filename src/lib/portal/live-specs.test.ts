import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSpecs, jsonSpecs, mergeSpecs } from './live-specs'

const part = (slot: string, name: string, quantity = 1, label: string | null = null) => ({ slot, quantity, label, componentAsset: { name } })

test('a base build becomes one spec per slot, GPU first, parts in a slot joined', () => {
  assert.deepEqual(buildSpecs([part('STORAGE', '1TB NVMe'), part('MEMORY', '64GB RAM'), part('GPU', 'RTX 4090', 2), part('STORAGE', '4TB SSD')]), [
    { key: 'GPU', value: '2× RTX 4090' },
    { key: 'Memory', value: '64GB RAM' },
    { key: 'Storage', value: '1TB NVMe + 4TB SSD' },
  ])
  assert.deepEqual(buildSpecs([part('OTHER', 'x', 1, 'Custom label')]), [{ key: 'Other', value: 'Custom label' }])
})

test('asset specs JSON in either shape; blanks dropped', () => {
  assert.deepEqual(jsonSpecs({ CPU: '64 cores', Empty: '' }), [{ key: 'CPU', value: '64 cores' }])
  assert.deepEqual(jsonSpecs([{ key: 'PSU', value: '1600W' }, { key: '', value: 'x' }]), [{ key: 'PSU', value: '1600W' }])
  assert.deepEqual(jsonSpecs(null), [])
})

test('a package merges its items\' builds by slot, without repeating a value', () => {
  assert.deepEqual(mergeSpecs([{ key: 'GPU', value: 'RTX 4090' }, { key: 'Memory', value: '64GB' }, { key: 'GPU', value: 'RTX 4090' }, { key: 'GPU', value: 'RTX 3080' }]), [
    { key: 'GPU', value: 'RTX 4090 + RTX 3080' },
    { key: 'Memory', value: '64GB' },
  ])
})
