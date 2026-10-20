import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseItemCsv } from './csv'
import { CSV_HEADER, CSV_TEMPLATE } from './csv-template'

test('the downloadable template parses cleanly', () => {
  const { rows, errors } = parseItemCsv(CSV_TEMPLATE)
  assert.deepEqual(errors, [])
  assert.equal(rows.length, 2)
  assert.ok(CSV_TEMPLATE.startsWith(CSV_HEADER))
})
