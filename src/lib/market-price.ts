/**
 * What makes a market price worth acting on.
 *
 * **Owner's decision, 2026-08-12:** market prices are maintained by hand. v1's
 * price scraper is not carried into v2 — the sources it found were too
 * inconsistent to price hardware against, so what is stored is what we have,
 * and it changes when somebody changes it.
 *
 * That decision retires the question these screens used to ask. "Older than
 * thirty days" was a useful prompt while a refresh job existed to answer it;
 * with no such job it is a complaint nothing can satisfy, and every one of the
 * 114 stored prices trips it — they were all written in a single run on
 * 2026-02-20 and none has moved since.
 *
 * The question that replaces it is who last vouched for the figure. The
 * scraper stamped its origin into `marketPriceSource` — "ebay.com
 * (auto-updated)", "reddit.com (auto-updated)" — so the marker separates a
 * price a crawler landed on from one a person typed on the asset record. Only
 * the latter drives a rate recommendation: a suggested monthly rate is a claim
 * about money, and 113 of the 114 stored figures have never been read by
 * anyone here.
 *
 * Prisma-free, so client components can import it.
 */

/** What v1's scraper appended to every source string it wrote. */
const SCRAPED_MARKER = "(auto-updated)";

/**
 * True when a person stood behind this price.
 *
 * An absent source counts as unconfirmed rather than confirmed: recording where
 * a price came from is required when one is entered by hand, so a blank means
 * nobody did, not that somebody did and said nothing.
 */
export function isConfirmedPrice(source: string | null | undefined): boolean {
  if (!source) return false;
  return !source.includes(SCRAPED_MARKER);
}
