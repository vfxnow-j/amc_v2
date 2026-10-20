import { prisma } from "@/lib/prisma";
import { migrateEntityDatabase } from "@/lib/entities/provision";

(async () => {
  const entities = await prisma.entity.findMany({ orderBy: { createdAt: "asc" } });
  for (const e of entities) {
    const { from, to } = await migrateEntityDatabase(e.dbName);
    await prisma.entity.update({ where: { id: e.id }, data: { schemaVersion: to } });
    console.log(`${e.slug}: v${from} -> v${to}`);
  }
  console.log(`${entities.length} entit${entities.length === 1 ? "y" : "ies"} checked.`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
