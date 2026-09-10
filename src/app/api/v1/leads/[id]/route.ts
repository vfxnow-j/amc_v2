import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { apiSuccess } from "@/lib/api-auth";
import { logAudit } from "@/lib/actions/audit";
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  authorizeLeadApi,
  optionalAmount,
  optionalEnum,
  optionalString,
  readJsonBody,
  validEmail,
} from "@/lib/leads/api";
import { serialize } from "@/lib/utils";

/**
 * `/api/v1/leads/[id]` — read, amend and delete one lead.
 *
 * PATCH is a genuine partial update: a field absent from the body is left
 * alone, and `null` is how a caller clears one. v1 keyed on `!== undefined`
 * and then wrote the value straight through, so `{"email": ""}` stored an
 * empty string that every downstream `if (lead.email)` then treated as an
 * address that exists. Blank means null here, everywhere.
 *
 * A status change writes the same `STATUS_CHANGE` activity the screen writes.
 * The lead record's history is the only place anybody looks to find out why a
 * lead is where it is, and a pipeline that moves without a line in it is how
 * an integration quietly becomes unaccountable.
 *
 * DELETE really deletes — `LeadActivity` cascades — and that is v1's
 * behaviour, kept. It is gated on an editor key and audited, and the audit row
 * outlives the lead, which is the only reason it is defensible at all.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorizeLeadApi(request, { editor: false, namespace: "api-leads-read" });
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, name: true } },
      convertedToClient: { select: { id: true, name: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });

  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  return apiSuccess(serialize(lead));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorizeLeadApi(request, { editor: true, namespace: "api-leads-write" });
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const data: Prisma.LeadUncheckedUpdateInput = {};

  if (body.name !== undefined) {
    const name = optionalString(body.name);
    if (!name) return NextResponse.json({ error: "name cannot be emptied" }, { status: 400 });
    data.name = name;
  }

  if (body.email !== undefined) {
    const email = optionalString(body.email);
    if (email && !validEmail(email)) {
      return NextResponse.json({ error: "email does not look like an address" }, { status: 400 });
    }
    data.email = email ? email.toLowerCase() : null;
  }

  if (body.phone !== undefined) data.phone = optionalString(body.phone) ?? null;
  if (body.companyName !== undefined) data.companyName = optionalString(body.companyName) ?? null;
  if (body.channel !== undefined) data.channel = optionalString(body.channel) ?? null;
  if (body.salesRep !== undefined) data.salesRep = optionalString(body.salesRep) ?? null;
  if (body.notes !== undefined) data.notes = optionalString(body.notes) ?? null;
  if (body.adCampaign !== undefined) data.adCampaign = optionalString(body.adCampaign) ?? null;
  if (body.adPlatform !== undefined) data.adPlatform = optionalString(body.adPlatform) ?? null;

  if (body.source !== undefined) {
    const source = optionalEnum(body.source, LEAD_SOURCES, "source");
    if (!source.ok) return NextResponse.json({ error: source.error }, { status: 400 });
    if (source.value) data.source = source.value;
  }

  let statusMoved: string | null = null;
  if (body.status !== undefined) {
    const status = optionalEnum(body.status, LEAD_STATUSES, "status");
    if (!status.ok) return NextResponse.json({ error: status.error }, { status: 400 });
    if (status.value && status.value !== existing.status) {
      data.status = status.value;
      statusMoved = status.value;
      // Both stamps the screen sets, so a lead lost through the API looks the
      // same on the record as one lost by hand.
      if (status.value === "LOST") data.lostAt = new Date();
    }
  }

  if (body.estimatedValue !== undefined) {
    const value = optionalAmount(body.estimatedValue, "estimatedValue");
    if (!value.ok) return NextResponse.json({ error: value.error }, { status: 400 });
    data.estimatedValue = value.value ?? null;
  }
  if (body.adCost !== undefined) {
    const value = optionalAmount(body.adCost, "adCost");
    if (!value.ok) return NextResponse.json({ error: value.error }, { status: 400 });
    data.adCost = value.value ?? null;
  }
  if (body.lostReason !== undefined) data.lostReason = optionalString(body.lostReason) ?? null;

  if (body.assignedToId !== undefined) {
    const assignedToId = optionalString(body.assignedToId);
    if (assignedToId) {
      const user = await prisma.user.findUnique({
        where: { id: assignedToId },
        select: { id: true },
      });
      if (!user) {
        return NextResponse.json({ error: "assignedToId is not a user here" }, { status: 400 });
      }
    }
    data.assignedToId = assignedToId ?? null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  const lead = await prisma.lead.update({
    where: { id },
    data,
    include: { assignedTo: { select: { id: true, name: true } } },
  });

  if (statusMoved) {
    await prisma.leadActivity.create({
      data: {
        leadId: id,
        type: "STATUS_CHANGE",
        title: `Pipeline moved: ${existing.status} → ${statusMoved}`,
        description: `Changed through the API by key ${gate.auth.apiKeyId ?? "unknown"}.`,
        metadata: { previousStatus: existing.status, newStatus: statusMoved, source: "api-v1" },
        createdById: gate.auth.userId,
      },
    });
  }

  await logAudit({
    action: "UPDATE",
    entityType: "Lead",
    entityId: lead.id,
    oldValues: { status: existing.status },
    newValues: { status: lead.status, fields: Object.keys(data), via: "api-v1" },
    userId: gate.auth.userId,
  });

  return apiSuccess(serialize(lead));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorizeLeadApi(request, { editor: true, namespace: "api-leads-write" });
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const existing = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, name: true, status: true, convertedToClientId: true },
  });
  if (!existing) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // A converted lead is the only record of where a client came from. Deleting
  // it loses the attribution and leaves the client behind anyway, so the API
  // refuses and says which client it is holding onto.
  if (existing.convertedToClientId) {
    return NextResponse.json(
      {
        error: "This lead has been converted; it is the only record of where that client came from.",
        clientId: existing.convertedToClientId,
      },
      { status: 409 },
    );
  }

  await prisma.lead.delete({ where: { id } });

  await logAudit({
    action: "DELETE",
    entityType: "Lead",
    entityId: id,
    oldValues: { name: existing.name, status: existing.status },
    newValues: { via: "api-v1" },
    userId: gate.auth.userId,
  });

  return apiSuccess({ deleted: true, id });
}
