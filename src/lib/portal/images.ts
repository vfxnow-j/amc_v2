import path from 'node:path'
import fs from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { MAX_IMAGES_PER_OFFER, imagePath, processImage } from './images-core'

export { MAX_EDGE, MAX_IMAGES_PER_OFFER, MAX_UPLOAD_BYTES, imagePath, imagesRoot, processImage, type ProcessedImage } from './images-core'

/**
 * Product images for portal offers (docs/portal-api.md, Phase 2).
 *
 * Every upload is decoded and re-encoded: a file is accepted only if sharp reads
 * it as JPEG, PNG or WebP by its contents (never its name or declared type), it
 * is auto-rotated, fitted inside MAX_EDGE, and written as WebP — which drops
 * EXIF, GPS and any other embedded metadata, and means what is served is always
 * an image AMC produced. SVG is refused: it can carry script.
 *
 * Files live under documents/portal-images/<offerId>/<id>.webp (gitignored,
 * like every uploaded document). A row's picture is never replaced — a new
 * image is a new row — so the portal can cache (id, version) forever. Only its
 * alt text and position change in place.
 */

export async function storeOfferImage(input: {
  offerId: string
  bytes: Buffer
  alt: string | null
  userId: string
}): Promise<{ id: string }> {
  const count = await prisma.portalOfferImage.count({ where: { offerId: input.offerId } })
  if (count >= MAX_IMAGES_PER_OFFER) throw new Error(`A product can have at most ${MAX_IMAGES_PER_OFFER} images.`)
  const image = await processImage(input.bytes)
  const last = await prisma.portalOfferImage.aggregate({ where: { offerId: input.offerId }, _max: { sortOrder: true } })
  // Row first for its id; the file is written before the row is visible to
  // anyone, and a failed write removes the row.
  const row = await prisma.portalOfferImage.create({
    data: {
      offerId: input.offerId,
      version: image.version,
      alt: input.alt?.trim().slice(0, 200) || null,
      width: image.width,
      height: image.height,
      bytes: image.webp.length,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
      createdById: input.userId,
    },
    select: { id: true },
  })
  try {
    const file = imagePath(input.offerId, row.id)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, image.webp, { flag: 'wx' })
  } catch (error) {
    await prisma.portalOfferImage.delete({ where: { id: row.id } }).catch(() => {})
    throw error
  }
  return row
}

/** The bytes of a stored image, or null when the row or its file is gone. */
export async function readOfferImage(imageId: string): Promise<{ bytes: Buffer; version: string; offerId: string } | null> {
  const row = await prisma.portalOfferImage.findUnique({ where: { id: imageId }, select: { offerId: true, version: true } })
  if (!row) return null
  try {
    return { bytes: await fs.readFile(imagePath(row.offerId, imageId)), version: row.version, offerId: row.offerId }
  } catch {
    return null
  }
}

/** Remove an image: the row, then the file (a missing file is not an error). */
export async function deleteOfferImageFile(offerId: string, imageId: string): Promise<void> {
  await fs.rm(imagePath(offerId, imageId), { force: true })
}
