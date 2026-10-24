import { getQuoteByToken } from "@/lib/actions/quote-tokens";
import { QuotePortal, type QuoteData } from "@/components/quote/quote-portal";
import { ViewBeacon } from "@/components/quote/view-beacon";
import { RefreshRequest } from "@/components/quote/refresh-request";
import { dayYear } from "@/lib/format";

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
    if (result.error === "revising") {
      const held = result as { orderNumber?: string };
      return (
        <Closed
          title="This quote is being updated"
          blurb={`We are making changes to ${held.orderNumber ? `quote ${held.orderNumber}` : "this quote"}. Please check back soon, and we will send you the revised quote. This link will work again then.`}
        />
      );
    }
    if (result.error === "This quote link has expired") {
      const expiredOn = (result as { expiredOn?: string }).expiredOn;
      return (
        <Closed
          title="This quote has expired"
          blurb={`${expiredOn ? `The pricing held until ${dayYear(new Date(expiredOn))}. ` : ""}Hardware prices change often, so this quote can no longer be accepted. Ask for an updated one and we will get back to you.`}
        >
          <RefreshRequest token={token} />
        </Closed>
      );
    }
    return <Closed title="Quote unavailable" blurb={result.error} />;
  }

  return (
    <>
      <QuotePortal token={token} quote={result as unknown as QuoteData} pdfHref={`/api/quote/${token}/pdf`} />
      <ViewBeacon token={token} />
    </>
  );
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

function Closed({ title, blurb, children }: { title: string; blurb: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-prose text-sm text-[#71717a]">{blurb}</p>
      {children}
    </div>
  );
}
