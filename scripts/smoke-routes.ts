import "dotenv/config";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { DASHBOARD_PAGE, NAV_CLUSTERS, SETTINGS_PAGE } from "@/lib/nav/clusters";

/**
 * Fetches every destination in the rail with a real session and reports what
 * came back.
 *
 * Screens are built one at a time against a database of real customer data, and
 * "it compiles" has never been the same claim as "it renders" — twice now a
 * screen has passed tsc and the production build and still failed on the actual
 * data. This walks the whole rail in one pass so a regression anywhere is
 * visible immediately, rather than the next time somebody happens to open that
 * page.
 *
 * Placeholder detection matters as much as the status code: an unbuilt screen
 * returns a perfectly healthy 200 from the `[...path]` catch-all, so counting
 * 200s alone would report a finished app long before it is one.
 *
 *   npx tsx scripts/smoke-routes.ts
 *   npx tsx scripts/smoke-routes.ts --verbose    # also print each record id used
 *
 * Exits non-zero if anything is broken (non-200, or a server error in the body),
 * so it can gate a commit. Placeholders are reported but never fail the run —
 * they are unbuilt work, not breakage.
 */

const BASE = process.env.APP_URL ?? "http://localhost:3001";
const VERBOSE = process.argv.includes("--verbose");

/**
 * The `[...path]` placeholder screen tags itself with this attribute.
 *
 * It used to be detected by matching its prose, which reported the Integrations
 * screen as unbuilt — that screen truthfully says Zapier's inbound handler "has
 * not been rebuilt in v2 yet". A real screen describing unbuilt work reads
 * exactly like a placeholder. One attribute cannot be ambiguous that way.
 */
const PLACEHOLDER_MARKER = 'data-unbuilt="true"';

/**
 * Record routes, and how to find one real id for each.
 *
 * A record screen can only be proven against a row that exists, and an empty
 * table is a different result from a broken screen — so a model with no rows is
 * reported as "no data to test", never as a pass.
 */
const RECORD_ROUTES: {
  label: string;
  path: (id: string) => string;
  find: () => Promise<string | null>;
}[] = [
  {
    label: "order record · rental",
    path: (id) => `/dashboard/orders/${id}`,
    find: () =>
      firstId(() =>
        prisma.reservation.findFirst({
          where: { reservationType: "RENTAL" },
          select: { id: true },
        }),
      ),
  },
  {
    // One record now serves all four types, and the type decides which cards
    // render — so walking one of each is the only way this catches a card that
    // only breaks on, say, a cloud order with no asset lines.
    label: "order record · sale",
    path: (id) => `/dashboard/orders/${id}`,
    find: () =>
      firstId(() =>
        prisma.reservation.findFirst({
          where: { reservationType: "SALE" },
          select: { id: true },
        }),
      ),
  },
  {
    label: "order record · rent to own",
    path: (id) => `/dashboard/orders/${id}`,
    find: () =>
      firstId(() =>
        prisma.reservation.findFirst({
          where: { reservationType: "RENT_TO_OWN" },
          select: { id: true },
        }),
      ),
  },
  {
    label: "order record · cloud",
    path: (id) => `/dashboard/orders/${id}`,
    find: () =>
      firstId(() =>
        prisma.reservation.findFirst({
          where: { reservationType: "CLOUD" },
          select: { id: true },
        }),
      ),
  },
  {
    label: "account record",
    path: (id) => `/dashboard/clients/${id}`,
    find: () => firstId(() => prisma.client.findFirst({ select: { id: true } })),
  },
  {
    label: "invoice record",
    path: (id) => `/dashboard/invoices/${id}`,
    find: () => firstId(() => prisma.invoice.findFirst({ select: { id: true } })),
  },
  {
    label: "asset record",
    path: (id) => `/dashboard/assets/${id}`,
    find: () => firstId(() => prisma.asset.findFirst({ select: { id: true } })),
  },
  {
    label: "unit record",
    path: (id) => `/dashboard/units/${id}`,
    find: () => firstId(() => prisma.assetUnit.findFirst({ select: { id: true } })),
  },
  {
    label: "vendor record",
    path: (id) => `/dashboard/vendors/${id}`,
    find: () => firstId(() => prisma.vendor.findFirst({ select: { id: true } })),
  },
  {
    label: "purchase order record",
    path: (id) => `/dashboard/purchase-orders/${id}`,
    find: () => firstId(() => prisma.purchaseOrder.findFirst({ select: { id: true } })),
  },
  {
    label: "lead record",
    path: (id) => `/dashboard/leads/${id}`,
    find: () => firstId(() => prisma.lead.findFirst({ select: { id: true } })),
  },
  {
    label: "work order record",
    path: (id) => `/dashboard/service/work-orders/${id}`,
    find: () => firstId(() => prisma.workOrder.findFirst({ select: { id: true } })),
  },
  {
    label: "lease record",
    path: (id) => `/dashboard/leases/${id}`,
    find: () => firstId(() => prisma.lease.findFirst({ select: { id: true } })),
  },
  {
    label: "rate card record",
    path: (id) => `/dashboard/rate-cards/${id}`,
    find: () => firstId(() => prisma.rateCard.findFirst({ select: { id: true } })),
  },
  {
    label: "audit record",
    path: (id) => `/dashboard/audits/${id}`,
    find: () =>
      firstId(() => prisma.inventoryAudit.findFirst({ select: { id: true } })),
  },
  {
    label: "scan list record",
    path: (id) => `/dashboard/audits/scan-lists/${id}`,
    find: () => firstId(() => prisma.scanList.findFirst({ select: { id: true } })),
  },
  {
    label: "user record",
    path: (id) => `/dashboard/settings/users/${id}`,
    find: () => firstId(() => prisma.user.findFirst({ select: { id: true } })),
  },
];

/**
 * Every static route on disk, discovered rather than listed.
 *
 * The rail names ~28 destinations, but the screens beneath them — six reports,
 * a dozen settings children, the import flows — are reachable only from inside
 * those screens. A hand-maintained list would have gone stale the first time
 * somebody added a child, and an unchecked route is exactly where a regression
 * hides.
 *
 * Dynamic segments are skipped here and probed above with a real id instead; a
 * literal "[id]" in a URL proves nothing.
 */
function staticRoutes(dir: string, prefix = ""): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx" && prefix) {
      found.push(prefix);
      continue;
    }
    if (!entry.isDirectory()) continue;
    // Route groups like (shell) don't appear in the URL; dynamic and catch-all
    // segments can't be fetched without a value.
    if (entry.name.startsWith("[")) continue;
    const segment = entry.name.startsWith("(") ? "" : `/${entry.name}`;
    found.push(...staticRoutes(join(dir, entry.name), prefix + segment));
  }

  return found;
}

async function firstId(
  query: () => Promise<{ id: string } | null>,
): Promise<string | null> {
  try {
    const row = await query();
    return row?.id ?? null;
  } catch {
    // The model may not exist on the generated client yet.
    return null;
  }
}

type Result = {
  path: string;
  label: string;
  status: number;
  bytes: number;
  placeholder: boolean;
  error: string | null;
  /** Set on a 307/308: where the retired route sends you. */
  location: string | null;
};

async function check(
  cookie: string,
  path: string,
  label: string,
): Promise<Result> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Cookie: `authjs.session-token=${cookie}` },
    redirect: "manual",
  });
  const body = await response.text();

  // The dev overlay and the production error boundary both leave a marker in
  // the streamed HTML even when the status line is 200, because the failure
  // happened inside a Suspense boundary after the shell had flushed.
  const error =
    /Unhandled Runtime Error|Application error: a server-side exception/i.exec(
      body,
    )?.[0] ?? null;

  return {
    path,
    label,
    status: response.status,
    bytes: body.length,
    placeholder: body.includes(PLACEHOLDER_MARKER),
    error,
    // Where a moved route sends you. `redirect: "manual"` above means this is
    // the shim's own answer, not the destination's.
    location: response.headers.get("location"),
  };
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@vfxnow.com" },
    select: { id: true, name: true, email: true, role: true },
  });

  const cookie = await encode({
    token: {
      id: user.id,
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 3600,
  });

  const targets: { path: string; label: string }[] = [];

  // The rail first, labelled by cluster, so the report reads in the order the
  // app is actually organised.
  const railLabel = new Map<string, string>();
  for (const cluster of NAV_CLUSTERS) {
    for (const page of cluster.pages) {
      railLabel.set(page.href, `${cluster.label} · ${page.label}`);
      targets.push({ path: page.href, label: `${cluster.label} · ${page.label}` });
    }
  }
  railLabel.set(DASHBOARD_PAGE.href, "Dashboard");
  targets.push({ path: DASHBOARD_PAGE.href, label: "Dashboard" });
  railLabel.set(SETTINGS_PAGE.href, "Settings");
  targets.push({ path: SETTINGS_PAGE.href, label: "Settings" });

  // Then everything else on disk — the children the rail never names.
  const onDisk = staticRoutes(join(process.cwd(), "src/app/(shell)"));
  for (const path of onDisk.sort()) {
    if (railLabel.has(path)) continue;
    targets.push({ path, label: "child" });
  }

  const missingData: string[] = [];
  for (const record of RECORD_ROUTES) {
    const id = await record.find();
    if (!id) {
      missingData.push(record.label);
      continue;
    }
    if (VERBOSE) console.log(`  ${record.label} → ${id}`);
    targets.push({ path: record.path(id), label: `record · ${record.label}` });
  }

  // Sequential on purpose: the dev server compiles routes on demand, and firing
  // thirty cold requests at once turns a slow compile into a timeout that looks
  // exactly like a broken screen.
  const results: Result[] = [];
  for (const target of targets) {
    results.push(await check(cookie, target.path, target.label));
  }

  // A 307 from a route that was deliberately retired is the shim working, not
  // a broken screen. Reservations, the contracts list and the old new-order
  // path all redirect into Orders now, and counting those as failures would
  // have meant the walk cried wolf on every run from here on. They are still
  // reported — a shim pointing nowhere is worth knowing about — but as moved.
  const moved = results.filter(
    (r) => (r.status === 307 || r.status === 308) && !r.error,
  );
  const broken = results.filter(
    (r) => r.error || (r.status !== 200 && !moved.includes(r)),
  );
  const placeholders = results.filter((r) => r.placeholder && !r.error);
  const built = results.filter(
    (r) => r.status === 200 && !r.placeholder && !r.error,
  );

  const pad = Math.max(...results.map((r) => r.path.length));
  for (const result of results) {
    const mark = result.error
      ? "ERR "
      : moved.includes(result)
        ? "→   "
        : result.status !== 200
          ? `${result.status} `
          : result.placeholder
            ? "todo"
            : "ok  ";
    const note = result.error
      ? `  — ${result.error}`
      : moved.includes(result)
        ? `  — moved to ${result.location ?? "nowhere"}`
        : "";
    console.log(
      `${mark} ${result.path.padEnd(pad)}  ${String(result.bytes).padStart(7)}b  ${result.label}${note}`,
    );
  }

  console.log(
    `\n${built.length} built · ${moved.length} moved · ${placeholders.length} still placeholder · ${broken.length} broken · ${results.length} checked`,
  );

  // A shim that redirects to a path nothing serves is worse than no shim: it
  // turns a 404 into a loop.
  const walked = new Set(results.map((r) => r.path));
  const danglers = moved.filter((r) => {
    const target = (r.location ?? "").split("?")[0];
    return target.startsWith("/dashboard") && !walked.has(target);
  });
  if (danglers.length > 0) {
    console.log("\nredirects pointing at unwalked paths:");
    for (const r of danglers) console.log(`  ${r.path} → ${r.location}`);
  }
  if (missingData.length > 0) {
    console.log(`no rows to test: ${missingData.join(", ")}`);
  }

  if (broken.length > 0) {
    console.log("\nbroken:");
    for (const result of broken) {
      console.log(`  ${result.path} — ${result.error ?? `HTTP ${result.status}`}`);
    }
    process.exitCode = 1;
  }
}

main().finally(() => prisma.$disconnect());
