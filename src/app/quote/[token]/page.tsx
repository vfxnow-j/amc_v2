import { getQuoteByToken } from "@/lib/actions/quote-tokens";
import { QuotePortal, type QuoteData } from "@/components/quote/quote-portal";

/**
 * Operate → the client's half of a quote.
 *
 * `getQuoteByToken` was ported whole and does the real work: it resolves the
 * token, refuses an expired or spent one, derives every figure from the lines
 * rather than the stored header columns, and returns the packages the client
 * gets to choose between. Nothing about pricing is recomputed here.
 *
 * Read on the server so the token never reaches the browser as an API call and
 * the page is complete on first paint — a client opening a quote on a phone in
 * a car park should not watch a spinner resolve a fetch.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export default async function QuotePage({ params }: Params) {
  const { token } = await params;
  const result = await getQuoteByToken(token);

  if ("error" in result && result.error) {
    if (result.error === "already_used") {
      return <AlreadyAnswered status={(result as { status?: string }).status} />;
    }
    return (
      <Closed
        title="Quote unavailable"
        blurb={
          result.error === "This quote link has expired"
            ? "This link has expired. Ask your account manager for a fresh one — the pricing may have changed."
            : result.error
        }
      />
    );
  }

  return <QuotePortal token={token} quote={result as unknown as QuoteData} />;
}

/** A quote answered once cannot be answered again — say which answer it got. */
function AlreadyAnswered({ status }: { status?: string }) {
  if (status === "REVISION") {
    return (
      <Closed
        title="Changes requested"
        blurb="We have your notes and are repricing. A revised quote will follow — this link is now closed."
      />
    );
  }
  if (status === "LOST" || status === "CANCELLED") {
    return (
      <Closed
        title="Quote declined"
        blurb="Thank you for letting us know. If anything changes, reply to the email this came in and we will pick it back up."
      />
    );
  }
  return (
    <Closed
      title="Already approved"
      blurb="This quote has been approved and is now an order. Your account manager will be in touch about scheduling."
    />
  );
}

function Closed({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-prose text-sm text-[#71717a]">{blurb}</p>
    </div>
  );
}
