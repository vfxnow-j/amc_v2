import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { paymentLineForOrder } from "@/lib/billing/order-payment-schedule";

/**
 * Read-only check for Task 4 (payment line): prints the headline + notes
 * paymentLineForOrder produces for a few ACTIVE monthly rentals — one with a
 * committed term, one without. No writes.
 */
async function main() {
  const withTerm = await prisma.reservation.findFirst({
    where: {
      status: "ACTIVE",
      reservationType: "RENTAL",
      billingCycleType: "MONTHLY",
      isRecurring: true,
      termMonths: { not: null },
    },
    select: { id: true, reservationNumber: true, termMonths: true },
  });
  const withoutTerm = await prisma.reservation.findFirst({
    where: {
      status: "ACTIVE",
      reservationType: "RENTAL",
      billingCycleType: "MONTHLY",
      isRecurring: true,
      termMonths: null,
    },
    select: { id: true, reservationNumber: true, termMonths: true },
  });
  const others = await prisma.reservation.findMany({
    where: {
      status: "ACTIVE",
      reservationType: "RENTAL",
      billingCycleType: "MONTHLY",
      isRecurring: true,
      id: { notIn: [withTerm?.id, withoutTerm?.id].filter(Boolean) as string[] },
    },
    select: { id: true, reservationNumber: true, termMonths: true },
    take: 3,
  });

  const picks = [withTerm, withoutTerm, ...others].filter(Boolean).slice(0, 3) as {
    id: string;
    reservationNumber: string;
    termMonths: number | null;
  }[];

  if (picks.length === 0) {
    console.log("No ACTIVE monthly rentals found.");
    return;
  }

  for (const r of picks) {
    const line = await paymentLineForOrder(r.id);
    console.log(`\n${r.reservationNumber} [${r.id}] (termMonths=${r.termMonths ?? "none"})`);
    if (!line) {
      console.log("  <no payment line — order.isRecurring/cycle not anchored, or an unexpected shape>");
      continue;
    }
    console.log(`  headline: ${line.headline}`);
    for (const note of line.notes) console.log(`  note: ${note}`);
  }
}

/**
 * Read-only check for the review fix: an order with several quote options
 * (packages) prices a *different* payment line per option, not just the
 * active one — reproducing what quote-portal.tsx now shows when a client
 * switches between them.
 */
async function printPerPackage(reservationId: string) {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      reservationNumber: true,
      packages: { select: { id: true, name: true, isActive: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!order) {
    console.log(`\n(no reservation ${reservationId})`);
    return;
  }
  console.log(`\n${order.reservationNumber} [${reservationId}] — ${order.packages.length} options`);
  for (const pkg of order.packages) {
    const line = await paymentLineForOrder(reservationId, pkg.id);
    console.log(`  ${pkg.name}${pkg.isActive ? " (active)" : ""}:`);
    console.log(`    ${line ? line.headline : "<no payment line>"}`);
    for (const note of line?.notes ?? []) console.log(`    ${note}`);
  }
}

main()
  .then(() => printPerPackage("cmml59ahz000q01pjtidrnp59"))
  .then(() => printPerPackage("cmtui6u3h00ej01o0nqhovu02"))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
