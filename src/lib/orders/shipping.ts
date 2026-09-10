import type { DeliveryMethod } from "@/generated/prisma/client";

/**
 * The vocabulary of how an order travels. Prisma-free on purpose.
 *
 * The card that reads shipping is a Server Component and its edit dialog is a
 * client one, and both need these labels. Exporting them from the card would
 * pull the card's query — and through it `lib/prisma` — into the browser
 * bundle, which is the same trap `queries/range.ts` and `nav/clusters.ts` are
 * each split out to avoid. A type-only import of the enum is erased at compile
 * time and costs nothing.
 *
 * `deliveryMethodLabels` in lib/types splits the same enum into an outbound set
 * and a return set, and drops two of the six from each — so a return booked as
 * CUSTOMER_PICKUP rendered as nothing at all. One map over the whole enum here,
 * and the two arrays below decide only what a picker *offers* per direction,
 * never what a stored value is called.
 */
export const METHOD_LABEL: Record<DeliveryMethod, string> = {
  CUSTOMER_PICKUP: "Customer collects",
  CUSTOMER_DROPOFF: "Customer returns it",
  LOCAL_DELIVERY: "Local delivery",
  LOCAL_PICKUP: "Local pickup",
  SMALL_PACKAGE: "Small package",
  FREIGHT: "Freight",
};

export const OUT_METHODS: DeliveryMethod[] = [
  "LOCAL_DELIVERY",
  "SMALL_PACKAGE",
  "FREIGHT",
  "CUSTOMER_PICKUP",
];

export const BACK_METHODS: DeliveryMethod[] = [
  "LOCAL_PICKUP",
  "SMALL_PACKAGE",
  "FREIGHT",
  "CUSTOMER_DROPOFF",
];

/** Methods where a parcel travels with a carrier, so a tracking number applies. */
export const CARRIED: DeliveryMethod[] = ["SMALL_PACKAGE", "FREIGHT"];
