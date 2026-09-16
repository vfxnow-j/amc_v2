import "dotenv/config";
import { prisma } from "@/lib/prisma";

/**
 * Give every account the rep who owned the enquiry it came from.
 *
 * `adoptLeadOwner` (lib/tracker/lead-link.ts) does this going forward, on all
 * four routes that open an account from a lead. It cannot reach backwards, and
 * every account converted before it landed is sitting in the claimable pool
 * with a rep's name on the lead behind it — which is not cosmetic. The Tracker's
 * default view is Mine, so those accounts show up for nobody; and the "going
 * quiet" alert deliberately has no recipient on an unowned account, so it
 * raises nothing at all for them.
 *
 *   npx tsx scripts/adopt-lead-owners.ts            # say what it would do
 *   npx tsx scripts/adopt-lead-owners.ts --apply    # do it
 *
 * Re-runnable, and worth re-running after a refresh from v1 brings new accounts
 * across. It only ever fills a blank: an account that already has an owner is
 * left alone, because a second lead binding to an established account is a new
 * contact ringing in, not a change of rep. Where two leads point at the same
 * account, the earliest wins — that is the rep who opened the relationship.
 */
async function main() {
  const apply = process.argv.includes("--apply");

  const leads = await prisma.lead.findMany({
    where: {
      assignedToId: { not: null },
      OR: [{ convertedToClientId: { not: null } }, { boundToClientId: { not: null } }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      name: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
      convertedToClientId: true,
      boundToClientId: true,
    },
  });

  // First lead wins, so the rep who opened the relationship keeps it.
  const claim = new Map<string, { userId: string; userName: string; leadName: string }>();
  for (const lead of leads) {
    const clientId = lead.boundToClientId ?? lead.convertedToClientId!;
    if (claim.has(clientId)) continue;
    claim.set(clientId, {
      userId: lead.assignedToId!,
      userName: lead.assignedTo?.name ?? "(unnamed)",
      leadName: lead.name,
    });
  }

  const clients = await prisma.client.findMany({
    where: { id: { in: [...claim.keys()] } },
    select: { id: true, name: true, ownerId: true, owner: { select: { name: true } } },
  });

  const toFill = clients.filter((client) => !client.ownerId);
  const alreadyOwned = clients.filter((client) => client.ownerId);

  const byRep = new Map<string, number>();
  for (const client of toFill) {
    const name = claim.get(client.id)!.userName;
    byRep.set(name, (byRep.get(name) ?? 0) + 1);
  }

  console.log(`${leads.length} leads with an assignee produced an account`);
  console.log(`${clients.length} distinct accounts behind them`);
  console.log(`${alreadyOwned.length} already owned — left alone`);
  console.log(`${toFill.length} would be given an owner:`);
  for (const [name, count] of [...byRep].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${name}: ${count}`);
  }

  if (!apply) {
    console.log("\nDry run. Nothing was changed. Re-run with --apply.");
    return;
  }

  let done = 0;
  for (const client of toFill) {
    // Guarded on ownerId being null in the write itself, not only in the read
    // above, so a rep claiming an account while this runs is not overruled.
    const result = await prisma.client.updateMany({
      where: { id: client.id, ownerId: null },
      data: { ownerId: claim.get(client.id)!.userId },
    });
    done += result.count;
  }
  console.log(`\n${done} accounts now have an owner.`);
}

main().finally(() => prisma.$disconnect());
