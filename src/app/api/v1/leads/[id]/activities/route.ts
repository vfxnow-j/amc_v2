import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { apiPaginated, apiSuccess, parsePagination } from "@/lib/api-auth";
import {
  LEAD_ACTIVITY_TYPES,
  authorizeLeadApi,
  optionalEnum,
  optionalString,
  readJsonBody,
} from "@/lib/leads/api";
import { serialize } from "@/lib/utils";

/**
 * `/api/v1/leads/[id]/activities` — the history, and the way to add to it.
 *
 * This is the half of the lead API that an outside system actually wants: a
 * dialler, a mail tool or a calendar posting "we spoke" onto the record so the
 * timeline on the screen is the whole story rather than the part that happened
 * inside this app.
 *
 * `metadata` is stored as sent, and that is deliberate — it is where a caller
 * keeps its own ids so it can reconcile later — but it is bounded, because a
 * Json column with no ceiling is how one chatty integration fills a table.
 */

/** Enough for a call recording url and a handful of ids; not a document store. */
const MAX_METADATA_BYTES = 4_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorizeLeadApi(request, { editor: false, namespace: "api-leads-read" });
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const { page, limit, offset } = parsePagination(request);

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const [activities, total] = await Promise.all([
    prisma.leadActivity.findMany({
      where: { leadId: id },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.leadActivity.count({ where: { leadId: id } }),
  ]);

  return apiPaginated(serialize(activities), { page, limit, total });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorizeLeadApi(request, { editor: true, namespace: "api-leads-write" });
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const type = optionalEnum(body.type, LEAD_ACTIVITY_TYPES, "type");
  if (!type.ok) return NextResponse.json({ error: type.error }, { status: 400 });
  if (!type.value) return NextResponse.json({ error: "type is required" }, { status: 400 });

  const title = optionalString(body.title);
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  let metadata: Prisma.InputJsonValue | undefined;
  if (body.metadata !== undefined && body.metadata !== null) {
    if (typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      return NextResponse.json({ error: "metadata must be a JSON object" }, { status: 400 });
    }
    const size = JSON.stringify(body.metadata).length;
    if (size > MAX_METADATA_BYTES) {
      return NextResponse.json(
        { error: `metadata is ${size} bytes; the ceiling is ${MAX_METADATA_BYTES}` },
        { status: 413 },
      );
    }
    metadata = body.metadata as Prisma.InputJsonValue;
  }

  const activity = await prisma.leadActivity.create({
    data: {
      leadId: id,
      type: type.value,
      title,
      description: optionalString(body.description) ?? null,
      metadata: metadata ?? undefined,
      // Null when the key's creator has since been removed; the row still
      // stands, which is the point of the column being optional.
      createdById: gate.auth.userId ?? null,
    },
  });

  // An activity is news on the lead itself — the list sorts on `updatedAt`,
  // and a lead somebody rang today belongs at the top of it.
  await prisma.lead.update({ where: { id }, data: { updatedAt: new Date() } });

  return apiSuccess(serialize(activity), 201);
}
