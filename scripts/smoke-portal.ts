import "dotenv/config";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { generatePortalToken } from "@/lib/portal/auth-core";
import { assertClientSafe } from "@/lib/portal/dto";
import { GET as health } from "@/app/api/v1/portal/health/route";

/**
 * Smoke test for the Portal API foundation (docs/portal-api-plan.md, Phase 1).
 *
 * Creates a throwaway PortalClient, drives GET /v1/health through the real
 * handler (auth → CIDR → scope → rate limit → request log) for each gate, and
 * deletes the client and its request-log rows in `finally` — so nothing is
 * left behind whether it passes or fails. The handler reads through the shared
 * Prisma client, which can't see rows inside an uncommitted transaction, so the
 * row is committed and then removed rather than rolled back.
 *
 * With SMOKE_BASE_URL (e.g. http://localhost:3011) it also calls `/v1/health`
 * over HTTP, to prove the rewrite and the proxy exclusion.
 *
 *   npx tsx scripts/smoke-portal.ts
 *   SMOKE_BASE_URL=http://localhost:3011 npx tsx scripts/smoke-portal.ts
 */

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

const ctx = { params: Promise.resolve({}) };
// The smoke runs as if behind a proxy that overwrites X-Real-IP; the
// x-forwarded-for below is a caller's spoof and must be ignored.
process.env.PORTAL_CLIENT_IP_HEADER = "x-real-ip";
delete process.env.PORTAL_TRUSTED_PROXY_HOPS;

function req(token: string | null, ip = "10.8.0.5") {
  const headers: Record<string, string> = { "x-real-ip": ip, "x-forwarded-for": "10.8.0.77" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/v1/portal/health", { headers });
}
async function call(token: string | null, ip?: string) {
  const res = await health(req(token, ip), ctx);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function main() {
  const { token, tokenHash, tokenPrefix } = generatePortalToken();
  const name = `smoke-portal ${new Date().toISOString()}`;
  const client = await prisma.portalClient.create({
    data: { name, tokenHash, tokenPrefix, scopes: ["portal:read"], rateLimitPerMin: 1000 },
  });

  try {
    let r = await call(null);
    check("no token → 401", r.status === 401 && r.body.code === "unauthorized", `${r.status} ${r.body.code}`);

    r = await call(generatePortalToken().token);
    check("unknown token → 401", r.status === 401, `${r.status} ${r.body.code}`);

    r = await call(token);
    const data = r.body.data as { ok?: boolean; portal?: string } | undefined;
    check("valid token → 200", r.status === 200 && data?.ok === true && data.portal === name, JSON.stringify(r.body));
    try {
      assertClientSafe(r.body);
      check("health body client-safe", true, "no internal keys");
    } catch (error) {
      check("health body client-safe", false, String(error));
    }

    await prisma.portalClient.update({ where: { id: client.id }, data: { scopes: ["portal:quote"] } });
    r = await call(token);
    check("missing scope → 403", r.status === 403 && r.body.code === "insufficient_scope", `${r.status} ${r.body.code}`);

    await prisma.portalClient.update({
      where: { id: client.id },
      data: { scopes: ["portal:read"], allowedCidrs: ["10.8.0.0/24"] },
    });
    r = await call(token, "8.8.8.8");
    check("outside CIDR → 403", r.status === 403 && r.body.code === "forbidden_ip", `${r.status} ${r.body.code}`);
    r = await call(token, "10.8.0.9");
    check("inside CIDR → 200", r.status === 200, `${r.status}`);

    delete process.env.PORTAL_CLIENT_IP_HEADER;
    r = await call(token, "10.8.0.9");
    check("allowlist, no IP source configured → 403", r.status === 403 && r.body.code === "ip_unverifiable", `${r.status} ${r.body.code}`);
    process.env.PORTAL_CLIENT_IP_HEADER = "x-real-ip";

    await prisma.portalClient.update({ where: { id: client.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    r = await call(token);
    check("expired → 401", r.status === 401, `${r.status} ${r.body.error}`);

    await prisma.portalClient.update({ where: { id: client.id }, data: { expiresAt: null, isActive: false } });
    r = await call(token);
    check("revoked → 401", r.status === 401, `${r.status} ${r.body.error}`);

    await prisma.portalClient.update({ where: { id: client.id }, data: { isActive: true } });
    const base = process.env.SMOKE_BASE_URL;
    if (base) {
      const anon = await fetch(`${base}/v1/health`);
      check("HTTP /v1/health no token → 401", anon.status === 401, `${anon.status}`);
      const authed = await fetch(`${base}/v1/health`, { headers: { authorization: `Bearer ${token}` } });
      const body = await authed.text();
      // Outside 10.8.0.0/24 (forbidden_ip), or no IP source set on the server (ip_unverifiable).
      check("HTTP /v1/health with allowlist → 403", authed.status === 403, `${authed.status} ${body}`);
      await prisma.portalClient.update({ where: { id: client.id }, data: { allowedCidrs: [] } });
      const open = await fetch(`${base}/v1/health`, { headers: { authorization: `Bearer ${token}` } });
      check("HTTP /v1/health → 200", open.status === 200, `${open.status} ${await open.text()}`);
    }

    // The request log is fire-and-forget; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const logged = await prisma.portalRequestLog.findMany({
      where: { portalClientId: client.id },
      select: { method: true, path: true, status: true },
    });
    check(
      "request log written, contract path, no bodies",
      logged.length >= 7 && logged.every((row) => row.path === "/v1/health" && row.method === "GET"),
      `${logged.length} rows: ${[...new Set(logged.map((row) => `${row.path} ${row.status}`))].join(", ")}`,
    );
    const touched = await prisma.portalClient.findUnique({ where: { id: client.id }, select: { lastUsedAt: true } });
    check("lastUsedAt stamped", !!touched?.lastUsedAt, String(touched?.lastUsedAt?.toISOString()));
  } finally {
    await prisma.portalRequestLog.deleteMany({ where: { portalClientId: client.id } });
    await prisma.portalClient.delete({ where: { id: client.id } });
    const left = await prisma.portalClient.count({ where: { id: client.id } });
    check("throwaway client removed", left === 0, `${left} left`);
  }

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  — ${r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
