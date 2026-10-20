import { prisma } from "@/lib/prisma";
import { migrateEntityDatabase } from "@/lib/entities/provision";

(async () => {
  const entities = await prisma.entity.findMany({ orderBy: { createdAt: "asc" } });
  const failed: string[] = [];
  for (const e of entities) {
    try {
      const { from, to } = await migrateEntityDatabase(e.dbName);
      await prisma.entity.update({ where: { id: e.id }, data: { schemaVersion: to } });
      console.log(`${e.slug}: v${from} -> v${to}`);
    } catch (error) {
      failed.push(e.slug);
      console.error(`${e.slug}: FAILED -`, (error as Error).message);
      const reached = (error as { reachedVersion?: unknown }).reachedVersion;
      if (typeof reached === "number") {
        await prisma.entity.update({ where: { id: e.id }, data: { schemaVersion: reached } }).catch(() => {});
      }
    }
  }
  console.log(`${entities.length} entit${entities.length === 1 ? "y" : "ies"} checked, ${failed.length} failed.`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
