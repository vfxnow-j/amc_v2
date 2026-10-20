import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.cwd(), 'src/app/entity')
const ROUTE_FILE = /^(page|route)\.(tsx|ts|jsx|js)$/

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return routes(p)
    return ROUTE_FILE.test(name) ? [p] : []
  })
}

/** Source without comments and string-free of the usual false positives (a commented-out gate must not count). */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// Anything that reads data: the entity database, or the lookups/queries built on it.
const READS = /\bctx\.db\b|\b(?:get[A-Z]\w*|locationOptions|locationNames|userNames)\s*\(/

test('there are entity routes to check', () => {
  assert.ok(routes(root).length >= 6)
})

test('every entity page or route awaits gateEntityPage, and before it reads anything', () => {
  for (const file of routes(root)) {
    const src = stripComments(readFileSync(file, 'utf8'))
    const gate = src.search(/await\s+gateEntityPage\s*\(/)
    assert.ok(gate >= 0, `${file} must call gateEntityPage (layouts do not re-render on client navigation)`)
    const read = src.search(READS)
    assert.ok(read < 0 || gate < read, `${file} reads data before gateEntityPage`)
  }
})

test('the checker itself catches a commented-out gate and a read before the gate', () => {
  assert.equal(stripComments('// await gateEntityPage(slug)\nconst x = 1').search(/await\s+gateEntityPage\s*\(/), -1)
  const late = stripComments('const i = await getItems(db)\nawait gateEntityPage(slug)')
  assert.ok(late.search(READS) < late.search(/await\s+gateEntityPage\s*\(/))
})
