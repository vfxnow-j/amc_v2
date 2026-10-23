import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";

/**
 * POST /api/csp-report — browsers tell us what the Content-Security-Policy
 * blocked (or, in report-only mode, would have blocked).
 *
 * Unauthenticated by necessity: the browser sends it, with no cookies. So it
 * does the least it can — logs the directive and the blocked origin, never the
 * body or the page's query string — and is rate-limited per client.
 */
export async function POST(request: NextRequest) {
  const client =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit("csp-report", client, 30, 60_000).allowed) {
    return new NextResponse(null, { status: 204 });
  }

  const text = await request.text().catch(() => "");
  if (text.length > 8_000) return new NextResponse(null, { status: 204 });

  try {
    const parsed = JSON.parse(text);
    const report = parsed["csp-report"] ?? parsed;
    const origin = (value: unknown) => {
      if (typeof value !== "string") return "";
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
      } catch {
        return value.slice(0, 40); // "inline", "eval", "data"
      }
    };
    console.warn(
      "[csp]",
      String(report["violated-directive"] ?? report.effectiveDirective ?? "").slice(0, 60),
      "blocked:",
      origin(report["blocked-uri"] ?? report.blockedURL),
      "on:",
      origin(report["document-uri"] ?? report.documentURL),
    );
  } catch {
    /* not a report; ignore */
  }
  return new NextResponse(null, { status: 204 });
}
