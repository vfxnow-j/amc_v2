import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getQuotePreview } from "@/lib/actions/quote-tokens";
import {
  QuotePortal,
  type PreviewStage,
  type QuoteData,
} from "@/components/quote/quote-portal";
import { getSessionUser } from "@/lib/roles";
import { STATUS_LABEL } from "@/lib/reservations/status";
import type { ReservationStatus } from "@/generated/prisma/client";

/**
 * The online quote, previewed by staff from the order record.
 *
 * Until now the only way to see what a client sees was Send quote, which mints
 * a link — and a link opened by staff is indistinguishable from one opened by
 * the client. This renders the same page from the order instead: no token, no
 * "viewed", no answer possible. It follows the order through its stages — a
 * draft shows what will be sent, a sent quote shows the live page, and once the
 * client has answered it says what their link now shows.
 *
 * Under /quote so it wears the client's fixed styling rather than the staff
 * theme; /quote is public in the proxy, so the session is checked here.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Quote preview" };

const STAGE_FOR: Record<string, PreviewStage> = {
  DRAFT: "draft",
  QUOTE_SENT: "sent",
  REVISION: "changes",
  APPROVED: "approved",
  PREPARING: "approved",
  SHIPPED: "approved",
  ACTIVE: "approved",
  COMPLETED: "approved",
  LOST: "declined",
  CANCELLED: "declined",
};

const STAGE_TITLE: Record<PreviewStage, string> = {
  draft: "Draft — not sent",
  sent: "Sent — live with the client",
  changes: "Changes requested",
  approved: "Approved",
  declined: "Declined",
};

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

type Params = { params: Promise<{ id: string }> };

export default async function QuotePreviewPage({ params }: Params) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?callbackUrl=/quote/preview/${id}`);

  const result = await getQuotePreview(id);
  if ("error" in result) {
    if (result.error === "unauthorized") redirect("/login");
    notFound();
  }

  const quote = result.quote as unknown as QuoteData;
  const stage = STAGE_FOR[quote.status] ?? "draft";
  const expired =
    stage === "sent" && !!quote.expiresAt && new Date(quote.expiresAt) < new Date();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-[#18181b] px-5 py-3 text-sm text-white">
        <span className="rounded-full bg-white/15 px-2 py-[2px] text-xs font-semibold uppercase tracking-wide">
          Staff preview
        </span>
        <span className="font-semibold">
          {expired
            ? "Sent — link expired"
            : stage === "approved" && quote.status !== "APPROVED"
              ? `Approved — now ${STATUS_LABEL[quote.status as ReservationStatus]?.toLowerCase() ?? quote.status}`
              : STAGE_TITLE[stage]}
        </span>
        <span className="text-white/70">
          {result.link
            ? `${result.link.count === 1 ? "Link" : `${result.link.count} links`} issued, latest ${DAY.format(new Date(result.link.issuedAt))}${
                result.link.answeredAt
                  ? ` · answered ${DAY.format(new Date(result.link.answeredAt))}`
                  : ""
              }`
            : "No link issued yet — Send quote on the order issues one"}
        </span>
        <Link
          href={`/dashboard/orders/${id}`}
          className="ml-auto font-semibold text-white underline-offset-2 hover:underline"
        >
          ← Back to {quote.reservationNumber}
        </Link>
      </div>

      <QuotePortal token="" quote={quote} preview={stage} />
    </div>
  );
}
