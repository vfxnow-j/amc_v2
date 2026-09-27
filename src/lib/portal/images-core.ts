import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { getProjectRoot } from '@/lib/documents/paths'

/** The pure half of product images — no database. See images.ts. */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
export const MAX_EDGE = 2000
export const MAX_IMAGES_PER_OFFER = 12
const ACCEPTED = new Set(['jpeg', 'png', 'webp'])

export function imagesRoot(): string {
  // The same documents/ folder uploads use (lib/documents/upload.ts documentsRoot).
  return path.join(getProjectRoot(), 'documents', 'portal-images')
}

/** The stored file for an image. Ids are cuids; anything else is refused. */
export function imagePath(offerId: string, imageId: string): string {
  if (!/^[a-z0-9]{10,40}$/i.test(offerId) || !/^[a-z0-9]{10,40}$/i.test(imageId)) throw new Error('Bad image id')
  return path.join(imagesRoot(), offerId, `${imageId}.webp`)
}

export type ProcessedImage = { webp: Buffer; width: number; height: number; version: string }

/** Decode, check, strip and re-encode. Throws a sentence a person can act on. */
export async function processImage(bytes: Buffer): Promise<ProcessedImage> {
  if (bytes.length === 0) throw new Error('The file is empty.')
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('Images must be under 15 MB.')
  let meta: sharp.Metadata
  try {
    // limitInputPixels guards against decompression bombs.
    meta = await sharp(bytes, { limitInputPixels: 50_000_000 }).metadata()
  } catch {
    throw new Error('That file is not an image AMC can read.')
  }
  if (!meta.format || !ACCEPTED.has(meta.format)) throw new Error('Use a JPEG, PNG or WebP image.')
  const { data, info } = await sharp(bytes, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
  const version = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16)
  return { webp: data, width: info.width, height: info.height, version }
}

