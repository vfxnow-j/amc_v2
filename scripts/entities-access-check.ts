/**
 * Throwaway-row check of saveEntityAccess against v2's own database. Creates users and an entity
 * prefixed zz-task7, never touches real rows, and deletes everything it made in a finally.
 */
import { prisma } from "@/lib/prisma";
import { saveEntityAccess } from "@/lib/entities/save-access";

let failed = 0;
const ok = (label: string, pass: boolean) => { if (!pass) failed++; console.log(pass ? "ok  " : "FAIL", label); };

(async () => {
  const tag = `zz-task7-${Date.now()}`;
  const userIds: string[] = [];
  let entityId: string | undefined;
  let entity2Id: string | undefined;
  try {
    const mk = async (role: "STAFF" | "FLOW_USER") => {
      const u = await prisma.user.create({ data: { email: `${tag}-${role.toLowerCase()}@example.invalid`, name: `${tag} ${role}`, role } });
      userIds.push(u.id);
      return u.id;
    };
    const staff = await mk("STAFF");
    const flow = await mk("FLOW_USER");
    entityId = (await prisma.entity.create({ data: { name: `${tag} a`, slug: `${tag}-a`, dbName: `vfxnow_ent_${tag.replace(/-/g, "_")}_a`, modules: ["INVENTORY"] } })).id;
    entity2Id = (await prisma.entity.create({ data: { name: `${tag} b`, slug: `${tag}-b`, dbName: `vfxnow_ent_${tag.replace(/-/g, "_")}_b`, modules: ["INVENTORY"] } })).id;

    const state = async (id: string) => {
      const u = await prisma.user.findUniqueOrThrow({ where: { id }, select: { entityAccess: true, entityScope: true, entityGrants: { select: { entityId: true } } } });
      return { ...u, ids: u.entityGrants.map((g) => g.entityId).sort() };
    };

    let r = await saveEntityAccess(prisma, staff, { entityAccess: true, scope: "SELECTED", entityIds: [entityId] });
    let s = await state(staff);
    ok("grant one entity", r.status === "ok" && s.entityAccess && s.entityScope === "SELECTED" && s.ids.length === 1 && s.ids[0] === entityId);

    r = await saveEntityAccess(prisma, staff, { entityAccess: true, scope: "SELECTED", entityIds: [entity2Id] });
    s = await state(staff);
    ok("replace swaps the grant", r.status === "ok" && s.ids.length === 1 && s.ids[0] === entity2Id);

    r = await saveEntityAccess(prisma, staff, { entityAccess: true, scope: "ALL", entityIds: [entityId, entity2Id, "zz-task7-stale-id"] });
    s = await state(staff);
    ok("stale id dropped, scope ALL kept", r.status === "ok" && s.entityScope === "ALL" && s.ids.length === 2 && !s.ids.includes("zz-task7-stale-id"));

    r = await saveEntityAccess(prisma, staff, { entityAccess: false, scope: "ALL", entityIds: [entityId] });
    s = await state(staff);
    ok("access off clears grants and resets scope", r.status === "ok" && !s.entityAccess && s.entityScope === "SELECTED" && s.ids.length === 0);

    r = await saveEntityAccess(prisma, flow, { entityAccess: true, scope: "SELECTED", entityIds: [entityId] });
    s = await state(flow);
    ok("flow user refused, nothing written", r.status === "error" && !s.entityAccess && s.ids.length === 0);

    r = await saveEntityAccess(prisma, flow, { entityAccess: false, scope: "SELECTED", entityIds: [] });
    ok("flow user may be set to no access", r.status === "ok");

    r = await saveEntityAccess(prisma, "zz-task7-missing", { entityAccess: false, scope: "SELECTED", entityIds: [] });
    ok("unknown user refused", r.status === "error");
  } finally {
    // Grants cascade from both sides; delete the users and entities we made.
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    const eids = [entityId, entity2Id].filter((x): x is string => !!x);
    if (eids.length) await prisma.entity.deleteMany({ where: { id: { in: eids } } });
    const left = await prisma.user.count({ where: { email: { startsWith: "zz-task7" } } }) + (await prisma.entity.count({ where: { slug: { startsWith: "zz-task7" } } }));
    console.log("leftover zz-task7 rows:", left);
    await prisma.$disconnect();
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all ok");
})();
