import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupRows, parseItemCsv } from './csv'

const header = 'name,manufacturer,model,category,tracking,serial,owner_tag,quantity,location'

test('parses serialized and quantity rows', () => {
  const { rows, errors } = parseItemCsv(`${header}\nRack server,Dell,R740,Servers,serialized,SN1,A-1,,Warehouse A\nCat6 cable,,,Cabling,quantity,,,40,Warehouse A`)
  assert.deepEqual(errors, [])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { name: 'Rack server', manufacturer: 'Dell', model: 'R740', category: 'Servers', trackingMode: 'SERIALIZED', serial: 'SN1', ownerTag: 'A-1', quantity: undefined, location: 'Warehouse A' })
  assert.equal(rows[1].quantity, 40)
})

test('handles quoted commas', () => {
  const { rows } = parseItemCsv(`${header}\n"Switch, 48 port",,,,serialized,SN2,,,Warehouse A`)
  assert.equal(rows[0].name, 'Switch, 48 port')
})

test('reports a bad row with its line number and keeps the good ones', () => {
  const { rows, errors } = parseItemCsv(`${header}\n,,,,serialized,,,,Warehouse A\nOK,,,,quantity,,,0,Warehouse A\nGood,,,,serialized,SN3,,,Warehouse A`)
  assert.equal(rows.length, 1)
  assert.equal(errors.length, 2)
  assert.match(errors[0], /line 2/i)
  assert.match(errors[1], /line 3/i)
})

test('a missing required column is one clear error', () => {
  const { rows, errors } = parseItemCsv('name,tracking\nX,serialized')
  assert.equal(rows.length, 0)
  assert.match(errors[0], /location/)
})

test('header case, spaces and a BOM are tolerated', () => {
  const { rows, errors } = parseItemCsv('﻿ Name , Tracking ,Owner Tag, LOCATION \nA,Serialized,T1,Shelf')
  assert.deepEqual(errors, [])
  assert.equal(rows[0].ownerTag, 'T1')
  assert.equal(rows[0].trackingMode, 'SERIALIZED')
})

test('CRLF line endings and a trailing newline', () => {
  const { rows, errors } = parseItemCsv(`${header}\r\nA,,,,serialized,S1,,,W\r\nB,,,,serialized,S2,,,W\r\n`)
  assert.deepEqual(errors, [])
  assert.equal(rows.length, 2)
})

test('a quoted newline stays inside its field and later line numbers stay physical', () => {
  const { rows, errors } = parseItemCsv(`${header}\n"Two\nlines",,,,serialized,S1,,,W\n,,,,serialized,,,,W`)
  assert.equal(rows[0].name, 'Two\nlines')
  assert.match(errors[0], /line 4/i)
})

test('an unterminated quote is one clear error', () => {
  const { rows, errors } = parseItemCsv(`${header}\n"Oops,,,,serialized,S1,,,W`)
  assert.equal(rows.length, 0)
  assert.match(errors[0], /quote/i)
})

test('duplicate serials for the same item inside the file are an error naming both lines', () => {
  const { errors } = parseItemCsv(`${header}\nA,Dell,R1,,serialized,SN1,,,W\nA,Dell,R1,,serialized,sn1,,,W`)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /line 3/i)
  assert.match(errors[0], /line 2/i)
})

test('a serialized row needs a serial or an owner tag', () => {
  const { errors } = parseItemCsv(`${header}\nA,,,,serialized,,,,W`)
  assert.match(errors[0], /serial or an owner tag/)
})

test('more than 500 data rows is one clear error', () => {
  const body = Array.from({ length: 501 }, (_, i) => `A,,,,serialized,S${i},,,W`).join('\n')
  const { rows, errors } = parseItemCsv(`${header}\n${body}`)
  assert.equal(rows.length, 0)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /500/)
})

test('exactly 500 rows is accepted', () => {
  const body = Array.from({ length: 500 }, (_, i) => `A,,,,serialized,S${i},,,W`).join('\n')
  assert.deepEqual(parseItemCsv(`${header}\n${body}`).errors, [])
})

test('groupRows groups by name, manufacturer and model, case-insensitively', () => {
  const { rows } = parseItemCsv(`${header}\nCam,Sony,A7,Cameras,serialized,S1,,,W\ncam,sony,a7,,serialized,S2,,,W\nCam,Sony,A9,,serialized,S3,,,W`)
  const { groups, errors } = groupRows(rows)
  assert.deepEqual(errors, [])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].units.length, 2)
  assert.equal(groups[0].category, 'Cameras')
})

test('groupRows sums nothing silently: one item at one location twice is an error', () => {
  const { rows } = parseItemCsv(`${header}\nCable,,,,quantity,,,5,W\nCable,,,,quantity,,,5,W`)
  assert.match(groupRows(rows).errors[0], /more than once/)
})

test('groupRows refuses one item that is both serialized and quantity', () => {
  const { rows } = parseItemCsv(`${header}\nX,,,,serialized,S1,,,W\nX,,,,quantity,,,5,W`)
  assert.match(groupRows(rows).errors[0], /both/)
})

test('groupRows keeps quantity rows at different locations', () => {
  const { rows } = parseItemCsv(`${header}\nCable,,,,quantity,,,5,W\nCable,,,,quantity,,,7,Shelf`)
  const { groups, errors } = groupRows(rows)
  assert.deepEqual(errors, [])
  assert.deepEqual(groups[0].stock, [{ location: 'W', quantity: 5 }, { location: 'Shelf', quantity: 7 }])
})
