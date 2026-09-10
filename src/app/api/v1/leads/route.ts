import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { apiPaginated, apiSuccess, parsePagination, parseSearchParams } from "@/lib/api-auth";
import { logAudit } from "@/lib/actions/audit";
import { findMatchingLead } from "@/lib/actions/leads";
import { syncLeadContactSafely } from "@/lib/integrations/hubspot";
import { notifyNewLead } from "@/lib/actions/notifications";
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
 * `/api/v1/leads` — the list, and the machine-facing way to open a lead.
 *
 * Ported from v1, where this had been the integration surface for a year, with
 * the v2 corrections described in `lib/leads/api.ts` plus one behavioural
 * change worth stating plainly:
 *
 * **POST deduplicates by default.** v1 opened a second record every time an
 * integration re-sent a submission, and the leads table is where that shows up
 * — the same person, twice, with half the history on each. Every other inbound
 * path in v2 already runs `findMatchingLead` first: the Zapier route merges,
 * the create form asks. So this asks too, in the only way HTTP has of asking —
 * a 409 carrying the id of the record it matched. A caller that genuinely
 * means "yes, a second person at that company" re-sends with
 * `allowDuplicate: true` and gets the create. Nothing is silently dropped and
 * nothing is silently doubled.
 *
 * The ad-attribution fields are accepted here and were not in v1. They are the
 * three the lead record already displays and, until the create form landed,
 * nothing in v2 could set — a paid-ads integration posting leads has the
 * campaign in hand at exactly the moment the lead is created and nowhere else.
 */

/** Both what `createLead` writes and what this route accepts. */
type LeadWriteFields = Pick<
  Prisma.LeadUncheckedCreateInput,
  | "name"
  | "email"
  | "phone"
  | "companyName"
  | "source"
  | "channel"
  | "salesRep"
  | "status"
  | "assignedToId"
  | "estimatedValue"
  | "notes"
  | "adCampaign"
  | "adPlatform"
  | "adCost"
>;

export async function GET(request: NextRequest) {
  const gate = await authorizeLeadApi(request, { editor: false, namespace: "api-leads-read" });
  if (!gate.ok) return gate.response;

  const { page, limit, offset } = parsePagination(request);
  const params = parseSearchParams(request);

  const search = params.get("search")?.trim();
  const status = optionalEnum(params.get("status") ?? undefined, LEAD_STATUSES, "status");
  if (!status.ok) return NextResponse.json({ error: status.error }, { status: 400 });
  const source = optionalEnum(params.get("source") ?? undefined, LEAD_SOURCES, "source");
  if (!source.ok) return NextResponse.json({ error: source.error }, { status: 400 });

  const assignedToId = params.get("assignedToId")?.trim();

  const where: Prisma.LeadWhereInput = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      { companyName: { contains: search, mode: "insensitive" } },
    ];
  }
  if (status.value) where.status = status.value;
  if (source.value) where.source = source.value;
  // "unassigned" is the query the leads screen exists to answer, and a bare
  // `assignedToId=` cannot express it — an empty string reads as absent.
  if (assignedToId === "none") where.assignedToId = null;
  else if (assignedToId) where.assignedToId = assignedToId;

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, name: true } },
        _count: { select: { activities: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.lead.count({ where }),
  ]);

  return apiPaginated(serialize(leads), { page, limit, total });
}

export async function POST(request: NextRequest) {
  const gate = await authorizeLeadApi(request, { editor: true, namespace: "api-leads-write" });
  if (!gate.ok) return gate.response;

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });

  const name = optionalString(body.name);
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const email = optionalString(body.email);
  if (email && !validEmail(email)) {
    return NextResponse.json({ error: "email does not look like an address" }, { status: 400 });
  }

  const source = optionalEnum(body.source, LEAD_SOURCES, "source");
  if (!source.ok) return NextResponse.json({ error: source.error }, { status: 400 });
  const status = optionalEnum(body.status, LEAD_STATUSES, "status");
  if (!status.ok) return NextResponse.json({ error: status.error }, { status: 400 });

  const estimatedValue = optionalAmount(body.estimatedValue, "estimatedValue");
  if (!estimatedValue.ok) return NextResponse.json({ error: estimatedValue.error }, { status: 400 });
  const adCost = optionalAmount(body.adCost, "adCost");
  if (!adCost.ok) return NextResponse.json({ error: adCost.error }, { status: 400 });

  const assignedToId = optionalString(body.assignedToId);
  if (assignedToId) {
    const user = await prisma.user.findUnique({ where: { id: assignedToId }, select: { id: true } });
    if (!user) {
      return NextResponse.json({ error: "assignedToId is not a user here" }, { status: 400 });
    }
  }

  const phone = optionalString(body.phone);
  const companyName = optionalString(body.companyName) ?? optionalString(body.company);

  if (body.allowDuplicate !== true) {
    const existing = await findMatchingLead({
      name,
      email: email ?? undefined,
      phone: phone ?? undefined,
      companyName: companyName ?? undefined,
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "A lead here already looks like this one. Re-send with allowDuplicate: true to open a second record.",
          existing: {
            id: existing.id,
            name: existing.name,
            companyName: existing.companyName,
            status: existing.status,
          },
        },
        { status: 409 },
      );
    }
  }

  const data: LeadWriteFields = {
    name,
    email: email?.toLowerCase() ?? null,
    phone: phone ?? null,
    companyName: companyName ?? null,
    source: source.value ?? "OTHER",
    channel: optionalString(body.channel) ?? "API",
    salesRep: optionalString(body.salesRep) ?? null,
    status: status.value ?? "NEW",
    assignedToId: assignedToId ?? null,
    estimatedValue: estimatedValue.value ?? null,
    notes: optionalString(body.notes) ?? null,
    adCampaign: optionalString(body.adCampaign) ?? null,
    adPlatform: optionalString(body.adPlatform) ?? null,
    adCost: adCost.value ?? null,
  };

  const lead = await prisma.lead.create({
    data,
    include: { assignedTo: { select: { id: true, name: true } } },
  });

  // The same trail the screen and the webhook both leave. A lead with no
  // history at all reads as a record somebody forgot to work.
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: "SYSTEM",
      title: `Lead created from: ${data.channel}`,
      description: `Filed through the API by key ${gate.auth.apiKeyId ?? "unknown"}.`,
      metadata: { source: "api-v1", channel: data.channel },
      createdById: gate.auth.userId,
    },
  });

  await logAudit({
    action: "CREATE",
    entityType: "Lead",
    entityId: lead.id,
    newValues: { name: lead.name, source: lead.source, via: "api-v1" },
    userId: gate.auth.userId,
  });

  notifyNewLead(lead).catch(() => {});

  // The same seam `createLead` uses, and off for the same reason: it returns
  // "disabled" without a socket unless HubSpot is both enabled and holding an
  // access token. A caller is told what happened rather than left to infer it
  // from a `hubspotContactId` that may or may not appear.
  const hubspot = await syncLeadContactSafely(lead);

  return apiSuccess(
    {
      ...serialize(lead),
      hubspotContactId: hubspot.synced ? hubspot.contactId : lead.hubspotContactId,
      hubspotSync: hubspot.synced ? "synced" : hubspot.reason,
    },
    201,
  );
}
