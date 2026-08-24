import { prisma } from "@/lib/prisma";

/**
 * Queries behind the Contract record.
 *
 * Contracts is a merge of three v1 screens over **two** entity types: sales and
 * rent-to-own are `Reservation`s, a lease is a `Lease`. One route serves both,
 * so the first thing it has to do is work out which it was handed — the list
 * links rows from three tabs at one URL, and asking the reader to know which
 * kind of id they hold would be a strange thing to demand of a link.
 */

export type ContractKind = "order" | "lease";

/** Which of the two a contract id belongs to, or null if neither. */
export async function getContractKind(id: string): Promise<ContractKind | null> {
  const [order, lease] = await Promise.all([
    prisma.reservation.count({
      where: { id, reservationType: { in: ["SALE", "RENT_TO_OWN"] } },
    }),
    prisma.lease.count({ where: { id } }),
  ]);
  if (order > 0) return "order";
  if (lease > 0) return "lease";
  return null;
}

/* ── Sales and rent-to-own ──────────────────────────────────────────────── */

export async function getContractOrder(id: string) {
  const order = await prisma.reservation.findFirst({
    where: { id, reservationType: { in: ["SALE", "RENT_TO_OWN"] } },
    select: {
      id: true,
      reservationNumber: true,
      reservationType: true,
      status: true,
      startDate: true,
      projectName: true,
      notes: true,
      internalNotes: true,
      subtotal: true,
      discountAmount: true,
      taxAmount: true,
      total: true,
      totalCost: true,
      totalMargin: true,
      priceVerified: true,
      priceVerifiedAt: true,
      convertedFromNumber: true,
      paymentTerms: true,
      rtoTermMonths: true,
      rtoMonthlyPayment: true,
      rtoBuyoutPrice: true,
      rtoInstallmentsPaid: true,
      rtoStartDate: true,
      rtoDefaultCount: true,
      rentalCreditPercent: true,
      rentalCreditAmount: true,
      client: { select: { id: true, name: true, paymentTerms: true } },
      _count: { select: { items: true, invoices: true } },
    },
  });

  if (!order) return null;

  return {
    ...order,
    subtotal: Number(order.subtotal),
    discountAmount: Number(order.discountAmount),
    taxAmount: Number(order.taxAmount),
    total: Number(order.total),
    // Null on anything priced before the cost fields existed, which is most of
    // the imported orders — a zero here would read as "no cost", which is a
    // very different claim from "nobody recorded one".
    totalCost: order.totalCost === null ? null : Number(order.totalCost),
    totalMargin: order.totalMargin === null ? null : Number(order.totalMargin),
    rtoMonthly:
      order.rtoMonthlyPayment === null ? null : Number(order.rtoMonthlyPayment),
    rtoBuyout: order.rtoBuyoutPrice === null ? null : Number(order.rtoBuyoutPrice),
    rentalCreditPercent: Number(order.rentalCreditPercent),
    rentalCreditAmount: Number(order.rentalCreditAmount),
    // Nullable columns with a zero default — nothing distinguishes "no
    // installments" from "never asked", so both are counted as none.
    installmentsPaid: order.rtoInstallmentsPaid ?? 0,
    defaultCount: order.rtoDefaultCount ?? 0,
    lineCount: order._count.items,
    invoiceCount: order._count.invoices,
  };
}

/**
 * The contract's lines, priced against what they cost.
 *
 * The order record shows these as things to pull; here they are shown as
 * margin, which is the question a sale asks and a rental doesn't. `costBasis`
 * is per unit, so the line's cost is cost × quantity — and where no cost was
 * recorded the line contributes to neither figure rather than to a margin of
 * 100%.
 *
 * **Only the active package is on the contract.** An order can hold several
 * priced configurations — RTO-2026-00001 has six, and its 58 lines add up to
 * $2.8M against a $449k contract — and exactly one `Package` carries
 * `isActive`. Its lines sum to the stored subtotal to the cent on every order
 * that has alternatives, so this filters to it and reports the rest as
 * alternatives rather than dropping them: they are real work somebody did, and
 * a reader who remembers pricing six variants needs to see that they survived.
 */
export async function getContractLines(id: string) {
  const [packages, items] = await Promise.all([
    prisma.package.findMany({
      where: { reservationId: id },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
    prisma.reservationItem.findMany({
      where: { reservationId: id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        description: true,
        quantity: true,
        rate: true,
        subtotal: true,
        costBasis: true,
        marginPercent: true,
        parentId: true,
        packageId: true,
        asset: { select: { id: true, name: true } },
      },
    }),
  ]);

  const activeIds = new Set(
    packages.filter((entry) => entry.isActive).map((entry) => entry.id),
  );
  // An order with no active package at all — or none recorded — is treated as
  // having everything on it, which is the pre-packages shape and still most of
  // the data. Better to over-report than to render an empty contract.
  const onContract = (packageId: string | null) =>
    activeIds.size === 0 || packageId === null || activeIds.has(packageId);

  const alternatives = packages
    .filter((entry) => !entry.isActive)
    .map((entry) => {
      const own = items.filter((item) => item.packageId === entry.id);
      return {
        id: entry.id,
        name: entry.name,
        lineCount: own.length,
        value: own.reduce((sum, item) => sum + Number(item.subtotal), 0),
      };
    })
    .filter((entry) => entry.lineCount > 0);

  const lines = items.filter((item) => onContract(item.packageId)).map((item) => {
    const cost = item.costBasis === null ? null : Number(item.costBasis);
    const revenue = Number(item.subtotal);
    return {
      id: item.id,
      label: item.asset?.name ?? item.description ?? "Ad-hoc item",
      assetId: item.asset?.id ?? null,
      quantity: item.quantity,
      rate: Number(item.rate),
      revenue,
      cost: cost === null ? null : cost * item.quantity,
      margin: cost === null ? null : revenue - cost * item.quantity,
      isComponent: item.parentId !== null,
    };
  });

  const priced = lines.filter((line) => line.cost !== null);

  return {
    lines,
    /** Priced configurations that were not chosen. Named, never summed in. */
    alternatives,
    /** Only the lines that carry a cost — the rest can't be spoken about. */
    costedCount: priced.length,
    costedRevenue: priced.reduce((sum, line) => sum + line.revenue, 0),
    costedCost: priced.reduce((sum, line) => sum + (line.cost ?? 0), 0),
  };
}

export async function getContractInvoices(id: string) {
  const invoices = await prisma.invoice.findMany({
    where: { reservationId: id },
    orderBy: { issueDate: "desc" },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      issueDate: true,
      dueDate: true,
      total: true,
      amountPaid: true,
    },
  });

  const live = invoices.filter(
    (invoice) => invoice.status !== "VOID" && invoice.status !== "CANCELLED",
  );

  return {
    rows: invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issued: invoice.issueDate,
      due: invoice.dueDate,
      total: Number(invoice.total),
      paid: Number(invoice.amountPaid),
    })),
    // Void and canceled invoices carry a total nobody is waiting for, so they
    // are listed but not counted — the same rule the Accounts record uses.
    invoiced: live.reduce((sum, invoice) => sum + Number(invoice.total), 0),
    paid: live.reduce((sum, invoice) => sum + Number(invoice.amountPaid), 0),
  };
}

/**
 * The units that actually changed hands on this sale.
 *
 * `AssetUnit.soldViaReservation` is an untyped id string rather than a relation,
 * so this is a second query rather than a join. It is stamped only by
 * `completeSale`; on this data 546 of 548 sold units carry no reservation at
 * all, which is why the empty state explains the gap instead of implying the
 * contract shipped nothing.
 */
export async function getContractUnits(id: string) {
  const units = await prisma.assetUnit.findMany({
    where: { soldViaReservation: id },
    orderBy: { soldAt: "desc" },
    select: {
      id: true,
      barcode: true,
      serialNumber: true,
      soldAt: true,
      soldPrice: true,
      asset: { select: { name: true } },
    },
  });

  return units.map((unit) => ({
    id: unit.id,
    barcode: unit.barcode,
    serialNumber: unit.serialNumber,
    soldAt: unit.soldAt,
    soldPrice: unit.soldPrice === null ? null : Number(unit.soldPrice),
    assetName: unit.asset.name,
  }));
}

/* ── Leases ─────────────────────────────────────────────────────────────── */

/**
 * A lease, and how far through paying for itself it is.
 *
 * Two figures matter and neither is a balance the schema holds:
 *
 * **Scheduled paid** is elapsed term × monthly payment, capped at the total. It
 * is what the payment schedule says should have gone out, not what has —
 * reconciling that needs the lender's statements, which v2 does not have. The
 * Contracts list derives it the same way and labels it the same way.
 *
 * **Earned** is the sum of `totalRevenue` across the units this lease financed.
 * That one is real: it is rental income actually booked against the hardware,
 * and it is the number the plan's "revenue tracked against paying it down"
 * asks for.
 *
 * `AssetUnit.loanAmount` is deliberately not summed. Every unit on a lease
 * carries the lease's *whole* amount rather than its share — 555 units × the
 * same $1,353,495.37 on FCB REFI 2024 — so summing it invents $751M. See the
 * `perUnitFinancing` flag, which is how the record says so on screen.
 */
export async function getLease(id: string, now = new Date()) {
  const lease = await prisma.lease.findUnique({
    where: { id },
    select: {
      id: true,
      leaseName: true,
      leaseNumber: true,
      lender: true,
      monthlyPayment: true,
      interestRate: true,
      totalAmount: true,
      payoffAmount: true,
      startDate: true,
      endDate: true,
      termMonths: true,
      status: true,
      paidOffDate: true,
      notes: true,
    },
  });
  if (!lease) return null;

  const [units, distinctLoans] = await Promise.all([
    prisma.assetUnit.aggregate({
      where: { leaseId: id },
      _sum: { totalRevenue: true, purchasePrice: true },
      _count: true,
    }),
    prisma.assetUnit.findMany({
      where: { leaseId: id },
      distinct: ["loanAmount"],
      select: { loanAmount: true },
      take: 3,
    }),
  ]);

  const monthly = Number(lease.monthlyPayment);
  const total = Number(lease.totalAmount);
  const elapsed = Math.max(
    0,
    Math.min(
      lease.termMonths,
      (now.getFullYear() - lease.startDate.getFullYear()) * 12 +
        (now.getMonth() - lease.startDate.getMonth()),
    ),
  );
  const scheduledPaid =
    lease.status === "PAID_OFF" ? total : Math.min(total, elapsed * monthly);

  return {
    ...lease,
    monthly,
    total,
    interestRate: Number(lease.interestRate),
    payoff: lease.payoffAmount === null ? null : Number(lease.payoffAmount),
    unitCount: units._count,
    earned: Number(units._sum.totalRevenue ?? 0),
    hardwareCost: Number(units._sum.purchasePrice ?? 0),
    elapsedMonths: elapsed,
    scheduledPaid,
    scheduledRemaining: Math.max(0, total - scheduledPaid),
    /**
     * True only if the units disagree about `loanAmount` — which would mean
     * somebody had recorded a real per-unit share. On every lease in this
     * database they agree, and they agree on the lease's whole total.
     */
    perUnitFinancing: distinctLoans.length > 1,
    /** No schedule to speak of: an imported placeholder, not a real lease. */
    unpriced: total === 0 && monthly === 0,
  };
}

export async function getLeaseUnits(id: string, take = 40) {
  const [records, total] = await Promise.all([
    prisma.assetUnit.findMany({
      where: { leaseId: id },
      orderBy: [{ totalRevenue: "desc" }, { barcode: "asc" }],
      take,
      select: {
        id: true,
        barcode: true,
        status: true,
        totalRevenue: true,
        purchasePrice: true,
        asset: { select: { name: true } },
      },
    }),
    prisma.assetUnit.count({ where: { leaseId: id } }),
  ]);

  return {
    total,
    rows: records.map((unit) => ({
      id: unit.id,
      barcode: unit.barcode,
      status: unit.status,
      assetName: unit.asset.name,
      earned: Number(unit.totalRevenue),
      cost: unit.purchasePrice === null ? null : Number(unit.purchasePrice),
    })),
  };
}
