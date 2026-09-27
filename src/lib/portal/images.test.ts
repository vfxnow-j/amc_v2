import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { imagePath, processImage, MAX_EDGE } from './images-core'

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#3366cc' } }).png().toBuffer()

test('a PNG comes back as WebP with its size and a stable version', async () => {
  const bytes = await png(40, 30)
  const a = await processImage(bytes)
  const b = await processImage(bytes)
  assert.equal((await sharp(a.webp).metadata()).format, 'webp')
  assert.deepEqual([a.width, a.height], [40, 30])
  assert.match(a.version, /^[0-9a-f]{16}$/)
  assert.equal(a.version, b.version)
})

test('a large image is fitted inside the max edge, never enlarged', async () => {
  const out = await processImage(await png(4000, 1000))
  assert.equal(out.width, MAX_EDGE)
  assert.equal(out.height, 500)
})

test('metadata is stripped: a JPEG with EXIF/GPS comes back without it', async () => {
  const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#000' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'someone', Make: 'Camera' }, IFD3: { GPSLatitudeRef: 'N' } })
    .toBuffer()
  assert.ok((await sharp(jpeg).metadata()).exif)
  const out = await processImage(jpeg)
  assert.equal((await sharp(out.webp).metadata()).exif, undefined)
})

test('refuses SVG, text, empty and unreadable files', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>')
  await assert.rejects(processImage(svg), /JPEG, PNG or WebP/)
  await assert.rejects(processImage(Buffer.from('hello, not an image')), /not an image/)
  await assert.rejects(processImage(Buffer.alloc(0)), /empty/)
})

test('image paths accept only plain ids', () => {
  assert.throws(() => imagePath('../etc', 'abcdefghij12'))
  assert.throws(() => imagePath('abcdefghij12', '../../passwd'))
  assert.ok(imagePath('abcdefghij12', 'klmnopqrst34').endsWith('portal-images/abcdefghij12/klmnopqrst34.webp'))
})
