import { prisma } from "../src/lib/prisma";

/**
 * Accounts that were entered as a person plus a company ("James Baker" /
 * "Dignitas", bakery@dignitas.gg) get that person as a contact on the account.
 *
 * Additive and idempotent: it never renames or edits an account, skips an
 * account that already has a contact with that email, and creates the contact
 * unapproved for email. Accounts with no company name are left for a person to
 * judge: the name may be a business ("Mfactor Creative") or an individual.
 *
 *   npx tsx --env-file=.env scripts/backfill-account-contacts.ts          # dry run
 *   npx tsx --env-file=.env scripts/backfill-account-contacts.ts --apply
 */
const apply = process.argv.includes("--apply");

async function main() {
  const clients = await prisma.client.findMany({
    where: { email: { not: null }, companyName: { not: null } },
    select: {
      id: true,
      name: true,
      companyName: true,
      email: true,
      phone: true,
      contacts: { select: { email: true } },
    },
    orderBy: { name: "asc" },
  });

  let made = 0;
  const skipped: string[] = [];
  for (const client of clients) {
    const email = client.email!.trim();
    const company = client.companyName!.trim();
    const person = client.name.trim();
    if (!company || company.toLowerCase() === person.toLowerCase()) {
      skipped.push(`${person} (name is the company)`);
      continue;
    }
    if (/@vfxnow\.com$/i.test(email)) {
      skipped.push(`${person} (internal address)`);
      continue;
    }
    if (client.contacts.some((c) => c.email && c.email.toLowerCase() === email.toLowerCase())) {
      skipped.push(`${person} (already a contact)`);
      continue;
    }
    const first = client.contacts.length === 0;
    console.log(`${apply ? "+" : "would add"} ${person} <${email}> at ${company}${first ? " (primary)" : ""}`);
    if (apply) {
      await prisma.clientContact.create({
        data: {
          clientId: client.id,
          name: person,
          email,
          phone: client.phone,
          role: first ? "Primary" : "Associated",
          isPrimary: first,
        },
      });
    }
    made += 1;
  }
  console.log(`\n${apply ? "Added" : "Would add"} ${made} contacts. Skipped ${skipped.length}:`);
  for (const line of skipped) console.log("  -", line);
  await prisma.$disconnect();
}

main();
