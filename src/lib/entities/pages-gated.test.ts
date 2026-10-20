import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.cwd(), 'src/app/entity')

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return pages(p)
    return name === 'page.tsx' ? [p] : []
  })
}

test('there are entity pages to check', () => {
  assert.ok(pages(root).length >= 6)
})

test('every entity page calls gateEntityPage (layouts do not re-render on client navigation)', () => {
  for (const file of pages(root)) {
    const src = readFileSync(file, 'utf8')
    assert.match(src, /await gateEntityPage\(/, `${file} must call gateEntityPage before reading anything`)
  }
})
