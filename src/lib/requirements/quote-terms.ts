import { prisma } from "@/lib/prisma";

/**
 * A signed quote settles the account's rental agreement.
 *
 * The portal does not merely collect a squiggle. To approve, a client types
 * their full name, draws a signature, and ticks a box — not pre-ticked — saying
 * they are authorized to accept on the company's behalf **and agree to the
 * rental terms and conditions**. That is the agreement. Leaving
 * `Client.agreementSignedAt` null afterwards meant the Requirements card went
 * on reporting the contract as outstanding against an account that had just
 * signed under it, and the next order was gated on a document the client had in
 * substance already given us.
 *
 * Two rules, both deliberate:
 *
 *  - **It only ever fills a blank.** An account that returned the countersigned
 *    template keeps that record. A quote signature is good evidence; a
 *    negotiated agreement on file is better, and overwriting the stronger
 *    artefact with the weaker one to gain a fresher date would be a bad trade.
 *  - **It files the artefact on the account, not only on the order.** "The
 *    agreement is done" with nothing to open is a claim, not a record. The
 *    signed quote PDF is filed a second time against the client as a
 *    RENTAL_AGREEMENT, sharing the file the order's copy points at — the same
 *    arrangement `requirements/store.ts` already uses when it files one
 *    agreement against both a client and an order.
 *
 * Called from `approveQuote` after the PDF exists, and deliberately not a
 * Server Function: it is reached through an action that has already established
 * the caller holds a live, unused quote token, and exporting it from a
 * `"use server"` file would publish it as a callable of its own.
 */
export async function settleAgreementFromQuote(
  reservationId: string,
  signerName: string,
  signedAt: Date,
): Promise<void> {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      clientId: true,
      reservationNumber: true,
      client: { select: { agreementSignedAt: true, prospectAt: true } },
    },
  });
  if (!order) return;
  // Already on file, by whatever route. Nothing to add, nothing to overwrite.
  if (order.client.agreementSignedAt) return;
  // A shell account is not an account yet — `prospectAt` marks a row
  // materialised only to hold a quote for somebody who has not onboarded. Their
  // onboarding is what turns it into an account and collects its requirements,
  // and marking one of those satisfied beforehand would have the Requirements
  // card vouching for a record nobody has verified. `sendOrderQuote` and
  // `approveOrder` both refuse on this flag for the same reason;
  // `createQuoteLink` does not, so a copied link is a real route to here.
  if (order.client.prospectAt) return;

  // The signed copy `generateSignedQuoteDocument` just wrote. If PDF generation
  // failed there is nothing to file — but the client did sign and tick, so the
  // account is still stamped and the order's own record carries the evidence.
  const signedQuote = await prisma.document.findFirst({
    where: {
      entityType: "RESERVATION",
      entityId: reservationId,
      documentType: "PROPOSAL",
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { filename: true, filePath: true, fileSize: true, createdById: true, metadata: true },
  });

  await prisma.$transaction(async (tx) => {
    if (signedQuote) {
      await tx.document.create({
        data: {
          documentType: "RENTAL_AGREEMENT",
          filename: signedQuote.filename,
          filePath: signedQuote.filePath,
          fileSize: signedQuote.fileSize,
          entityType: "CLIENT",
          entityId: order.clientId,
          isSigned: true,
          signedBy: signerName,
          signedAt,
          metadata: {
            acceptedWith: order.reservationNumber,
            reservationId,
            via: "quote-signature",
          },
          createdById: signedQuote.createdById,
        },
      });
    }

    await tx.client.update({
      where: { id: order.clientId },
      data: {
        agreementSignedAt: signedAt,
        agreementSignerName: signerName,
        agreementSource: "QUOTE_SIGNATURE",
        agreementReservationId: reservationId,
      },
    });
  });
}
