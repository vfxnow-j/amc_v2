import { NextRequest, NextResponse } from "next/server";
import type { QcResult } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/utils/rate-limit";

/**
 * POST /api/v1/service/qc-runs — a bench rig files a test result.
 *
 * Key-authenticated like the rest of /api/v1, so a test machine can post
 * without a session. The rig identifies the work order by its number
 * ("WO-2026-0007") rather than a cuid, because that is what is printed on the
 * bench sheet and typed into a script.
 *
 * Deliberately does not move the work order's status. A rig reports what it
 * measured; deciding the unit is scrap is a person's call, and closing is what
 * puts a unit back on the shelf or retires it.
 */

const RESULTS: QcResult[] = ["QUEUED", "RUNNING", "PASS", "FAIL"];

export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status ?? 401 },
    );
  }

  // A rig in a retry loop shouldn't be able to fill the table.
  const limit = checkRateLimit("qc-runs", auth.apiKeyId ?? "unknown", 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many runs filed. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const {
    workOrderNumber,
    testName,
    result,
    durationSec,
    output,
    logUrl,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof workOrderNumber !== "string" || typeof testName !== "string") {
    return NextResponse.json(
      { error: "workOrderNumber and testName are required" },
      { status: 400 },
    );
  }
  if (!RESULTS.includes(result as QcResult)) {
    return NextResponse.json(
      { error: `result must be one of ${RESULTS.join(", ")}` },
      { status: 400 },
    );
  }

  const workOrder = await prisma.workOrder.findUnique({
    where: { number: workOrderNumber },
    select: { id: true, status: true },
  });
  if (!workOrder) {
    return NextResponse.json(
      { error: `No work order numbered ${workOrderNumber}` },
      { status: 404 },
    );
  }
  if (workOrder.status === "CLOSED_PASS" || workOrder.status === "CLOSED_SCRAP") {
    return NextResponse.json(
      { error: `${workOrderNumber} is closed; reopen it or raise a new one` },
      { status: 409 },
    );
  }

  const run = await prisma.qcTestRun.create({
    data: {
      workOrderId: workOrder.id,
      testName,
      result: result as QcResult,
      ranAt: result === "QUEUED" ? null : new Date(),
      durationSec: typeof durationSec === "number" ? Math.round(durationSec) : null,
      output: typeof output === "string" ? output : null,
      logUrl: typeof logUrl === "string" ? logUrl : null,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: run.id, workOrderId: workOrder.id }, { status: 201 });
}
