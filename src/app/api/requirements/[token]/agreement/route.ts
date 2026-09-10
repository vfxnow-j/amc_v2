import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs/promises";
import { readTemplateMeta, templatePathIfPresent } from "@/lib/requirements/store";
import { resolveRequirementToken } from "@/lib/requirements/token";

/**
 * The agreement itself, so the person signing can read what they are signing.
 *
 * `/api/documents/[id]` already serves stored documents and is session-gated on
 * purpose — a token that let somebody sign is not a licence to read back
 * anything else on file. This serves one thing only, the blank template, and
 * only to a live token that actually asked for a signature. Nothing about the
 * client's own documents is reachable through it.
 *
 * A missing template is a 404 with a sentence rather than an empty tab: it is
 * the state this instance is in, and the portal already says as much.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/requirements/[token]/agreement">,
) {
  const { token } = await ctx.params;

  const grant = await resolveRequirementToken(token);
  if (!grant.ok) {
    return NextResponse.json(
      { error: grant.message },
      { status: grant.reason === "expired" ? 410 : 404, headers: NO_STORE },
    );
  }

  if (!grant.asked.includes("AGREEMENT")) {
    return NextResponse.json(
      { error: "This link did not ask for a signature." },
      { status: 403, headers: NO_STORE },
    );
  }

  const path = await templatePathIfPresent();
  if (!path) {
    return NextResponse.json(
      {
        error:
          "There is no agreement on file yet. We will send it across separately.",
      },
      { status: 404, headers: NO_STORE },
    );
  }

  const meta = await readTemplateMeta();
  const file = await fs.readFile(path);
  const name = (meta?.filename ?? "rental-agreement.pdf").replace(/"/g, "");

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Content-Length": String(file.length),
      ...NO_STORE,
    },
  });
}

const NO_STORE = { "Cache-Control": "private, no-store" };
