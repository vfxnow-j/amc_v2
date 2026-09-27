import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { readOfferImage } from '@/lib/portal/images'

/**
 * GET /v1/images/{id}?v=<version> — a product image's bytes (image/webp).
 *
 * Only for a published offer: an image of a hidden or retired offer is a 404,
 * like the offer itself. `v` is optional; when given it must match, so a stale
 * link 404s rather than serving a different picture under an old version. An
 * (id, version) pair never changes content, so the portal caches it forever.
 */
export const GET = withPortal<{ id: string }>('portal:read', async (req, { params }) => {
  const id = params.id
  if (!/^[a-z0-9]{10,40}$/i.test(id)) throw notFound('No such image')
  const image = await readOfferImage(id)
  if (!image) throw notFound('No such image')
  const v = req.nextUrl.searchParams.get('v')
  if (v && v !== image.version) throw notFound('No such image version')
  const offer = await prisma.portalOffer.findUnique({ where: { id: image.offerId }, select: { isVisible: true } })
  if (!offer?.isVisible) throw notFound('No such image')
  return new Response(new Uint8Array(image.bytes), {
    status: 200,
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(image.bytes.length),
      ETag: `"${image.version}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
