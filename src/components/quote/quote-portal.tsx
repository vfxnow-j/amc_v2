"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import {
  approveQuote,
  denyQuote,
  requestQuoteChanges,
} from "@/lib/actions/quote-tokens";

// react-signature-canvas touches `document` at import, so it can only be
// loaded in the browser. The type is loose because the package ships its own
// ref shape and pinning it here buys nothing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SignatureCanvas = dynamic(() => import("react-signature-canvas") as any, {
  ssr: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

export type QuoteItem = {
  id: string;
  name: string;
  quantity: number;
  pricingType: string;
  rate: number;
  subtotal: number;
  assetId: string | null;
  availableUnits: number;
  isOneTime: boolean;
  parentId?: string | null;
  isComponent?: boolean;
  configuredTotal?: number;
};

export type QuoteCategory = { category: string; items: QuoteItem[] };

export type QuotePackage = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  itemsByCategory: QuoteCategory[];
  subtotal: number;
  deliveryCost: number;
  returnCost: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
};

export type QuoteData = {
  reservationNumber: string;
  reservationType: string;
  status: string;
  issuedAt: string;
  expiresAt: string;
  clientName: string;
  companyName: string | null;
  projectName: string | null;
  startDate: string;
  endDate: string;
  itemsByCategory: QuoteCategory[];
  subtotal: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  deliveryCost: number;
  returnCost: number;
  deliveryMethod: string | null;
  deliveryAddress: string | null;
  deliveryDate: string | null;
  deliveryNotes: string | null;
  returnMethod: string | null;
  returnDate: string | null;
  billingCycleType: string;
  isRecurring: boolean;
  notes: string | null;
  rtoTermMonths: number | null;
  rtoMonthlyPayment: number | null;
  rtoBuyoutPrice: number | null;
  packages?: QuotePackage[];
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);

const day = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const RATE_SUFFIX: Record<string, string> = {
  DAILY: "/day",
  WEEKLY: "/week",
  MONTHLY: "/month",
  FLAT: "",
  ONE_TIME: "",
};

const CYCLE_TERM: Record<string, string> = {
  ONE_TIME: "A single charge covering the whole term.",
  DAILY: "Billed daily for the duration.",
  WEEKLY: "Billed weekly for the duration.",
  BI_WEEKLY: "Billed every fortnight for the duration.",
  MONTHLY: "Billed monthly for the duration.",
  CUSTOM: "Billed on an agreed cycle.",
};

const METHOD_LABEL: Record<string, string> = {
  PICKUP: "Collection from us",
  DELIVERY: "Delivery",
  FREIGHT: "Freight",
  SMALL_PACKAGE: "Small package",
  COURIER: "Courier",
};

type Answer = "approved" | "changes" | "declined";

/**
 * The online quote.
 *
 * A replica of v1's in what it does — see the same quote, pick between
 * packages, approve it with a signature, ask for changes, or decline — and
 * deliberately not a replica in how it looks: the internal app was redrawn in
 * v2 and a client-facing document that still looked like v1 would be the one
 * place the rebuild leaked.
 *
 * The three answers are the same three server actions v1 called through its own
 * API routes. They are called directly here: they carry no auth by design (the
 * token *is* the authorization) and routing them through `/api` again would add
 * a hop that can fail without adding a check that can catch anything.
 *
 * A quote can be answered exactly once. That is enforced on the token, not
 * here — this only stops offering the buttons after an answer lands, and says
 * which answer it was.
 */
export function QuotePortal({ token, quote }: { token: string; quote: QuoteData }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [panel, setPanel] = useState<"approve" | "changes" | "decline" | null>(null);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const hasPackages = !!quote.packages && quote.packages.length > 1;
  const [selectedPackageId, setSelectedPackageId] = useState(
    () => quote.packages?.find((option) => option.isActive)?.id ?? "",
  );

  const selected = useMemo(
    () =>
      hasPackages
        ? quote.packages!.find((option) => option.id === selectedPackageId)
        : undefined,
    [hasPackages, quote.packages, selectedPackageId],
  );

  // One shape for the body whether or not there are options to choose from.
  const shown = {
    categories: selected?.itemsByCategory ?? quote.itemsByCategory,
    subtotal: selected?.subtotal ?? quote.subtotal,
    discountAmount: selected?.discountAmount ?? quote.discountAmount,
    taxAmount: selected?.taxAmount ?? quote.taxAmount,
    deliveryCost: selected?.deliveryCost ?? quote.deliveryCost,
    returnCost: selected?.returnCost ?? quote.returnCost,
    total: selected?.total ?? quote.total,
  };

  const expired = new Date(quote.expiresAt) < new Date();

  if (answer) return <Answered answer={answer} />;

  return (
    <div className="flex flex-col gap-4">
      <Header quote={quote} total={shown.total} />

      {hasPackages ? (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold tracking-tight">Choose an option</h2>
          <p className="mt-1 text-xs text-[#71717a]">
            Approving confirms the option selected here.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {quote.packages!.map((option) => {
              const active = option.id === selectedPackageId;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSelectedPackageId(option.id)}
                  aria-pressed={active}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? "border-[#18181b] bg-[#fafafa]"
                      : "border-[#e4e4e7] hover:border-[#a1a1aa]"
                  }`}
                >
                  <span className="block text-sm font-semibold">{option.name}</span>
                  {option.description ? (
                    <span className="mt-[2px] block text-xs text-[#71717a]">
                      {option.description}
                    </span>
                  ) : null}
                  <span className="mt-2 block text-base font-bold tabular-nums">
                    {money(option.total)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <Lines categories={shown.categories} />

      <Totals quote={quote} shown={shown} />

      {quote.rtoTermMonths || quote.rtoMonthlyPayment ? (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold tracking-tight">Rent-to-own terms</h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <Detail label="Term">
              {quote.rtoTermMonths ? `${quote.rtoTermMonths} months` : "—"}
            </Detail>
            <Detail label="Monthly">
              {quote.rtoMonthlyPayment ? money(quote.rtoMonthlyPayment) : "—"}
            </Detail>
            <Detail label="Buyout">
              {quote.rtoBuyoutPrice ? money(quote.rtoBuyoutPrice) : "—"}
            </Detail>
          </dl>
          <p className="mt-3 text-xs text-[#71717a]">
            Ownership transfers once the full term is paid.
          </p>
        </section>
      ) : null}

      {quote.deliveryMethod || quote.returnMethod || quote.deliveryAddress ? (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold tracking-tight">Getting it to you</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            {quote.deliveryMethod ? (
              <Detail label="Out">
                {METHOD_LABEL[quote.deliveryMethod] ?? quote.deliveryMethod}
                {quote.deliveryDate ? ` · ${day(quote.deliveryDate)}` : ""}
              </Detail>
            ) : null}
            {quote.returnMethod ? (
              <Detail label="Back">
                {METHOD_LABEL[quote.returnMethod] ?? quote.returnMethod}
                {quote.returnDate ? ` · ${day(quote.returnDate)}` : ""}
              </Detail>
            ) : null}
            {quote.deliveryAddress ? (
              <Detail label="Address">{quote.deliveryAddress}</Detail>
            ) : null}
          </dl>
          {quote.deliveryNotes ? (
            <p className="mt-3 whitespace-pre-line text-xs text-[#71717a]">
              {quote.deliveryNotes}
            </p>
          ) : null}
        </section>
      ) : null}

      {quote.notes ? (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold tracking-tight">Notes</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-[#3f3f46]">
            {quote.notes}
          </p>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">
          {error}
        </p>
      ) : null}

      {expired ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-[#71717a] shadow-sm">
          The pricing on this quote held until {day(quote.expiresAt)} and can no
          longer be accepted online. Reply to the email it came in and we will
          reissue it.
        </p>
      ) : panel === null ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setPanel("approve")}
            className="flex-1 rounded-xl bg-[#16a34a] px-6 py-3 text-sm font-semibold text-white hover:bg-[#15803d]"
          >
            Approve quote
          </button>
          <button
            type="button"
            onClick={() => setPanel("changes")}
            className="rounded-xl border border-[#d4d4d8] bg-white px-6 py-3 text-sm font-semibold hover:bg-[#fafafa]"
          >
            Request changes
          </button>
          <button
            type="button"
            onClick={() => setPanel("decline")}
            className="rounded-xl border border-[#d4d4d8] bg-white px-6 py-3 text-sm font-semibold text-[#b91c1c] hover:bg-[#fef2f2]"
          >
            Decline
          </button>
        </div>
      ) : panel === "approve" ? (
        <ApprovePanel
          busy={busy}
          onBack={() => setPanel(null)}
          onSubmit={(signerName, signature) =>
            startTransition(async () => {
              setError("");
              try {
                await approveQuote(
                  token,
                  signerName,
                  signature,
                  undefined,
                  hasPackages ? selectedPackageId : undefined,
                );
                setAnswer("approved");
              } catch (problem) {
                setError(
                  problem instanceof Error
                    ? problem.message
                    : "That did not go through. Try again, or reply to the email this came in.",
                );
              }
            })
          }
        />
      ) : (
        <ReasonPanel
          kind={panel}
          busy={busy}
          onBack={() => setPanel(null)}
          onSubmit={(text) =>
            startTransition(async () => {
              setError("");
              try {
                if (panel === "changes") {
                  await requestQuoteChanges(token, text);
                  setAnswer("changes");
                } else {
                  await denyQuote(token, text || undefined);
                  setAnswer("declined");
                }
              } catch (problem) {
                setError(
                  problem instanceof Error
                    ? problem.message
                    : "That did not go through. Try again, or reply to the email this came in.",
                );
              }
            })
          }
        />
      )}
    </div>
  );
}

function Header({ quote, total }: { quote: QuoteData; total: number }) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-[#a1a1aa]">
            Quote {quote.reservationNumber}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {quote.companyName || quote.clientName}
          </h1>
          <p className="mt-1 text-sm text-[#71717a]">
            {quote.projectName ? `${quote.projectName} · ` : ""}
            {day(quote.startDate)} – {day(quote.endDate)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold tabular-nums">{money(total)}</p>
          <p className="mt-1 text-xs text-[#71717a]">
            {CYCLE_TERM[quote.billingCycleType] ?? ""}
          </p>
        </div>
      </div>
      <p className="mt-4 border-t border-[#f4f4f5] pt-3 text-xs text-[#a1a1aa]">
        Issued {day(quote.issuedAt)} · pricing held until {day(quote.expiresAt)}
      </p>
    </section>
  );
}

function Lines({ categories }: { categories: QuoteCategory[] }) {
  if (categories.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-5 text-sm text-[#71717a] shadow-sm">
        There is nothing on this quote yet. Reply to the email it came in and we
        will send a complete one.
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {categories.map((group) => (
        <div key={group.category} className="border-b border-[#f4f4f5] last:border-b-0">
          <p className="bg-[#fafafa] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-[#71717a]">
            {group.category}
          </p>
          <ul>
            {group.items.map((item) => (
              <li
                key={item.id}
                className={`grid grid-cols-[1fr_auto] items-baseline gap-3 px-5 py-3 text-sm ${
                  item.isComponent ? "bg-[#fcfcfd]" : ""
                }`}
              >
                <span className={item.isComponent ? "pl-4 text-[#52525b]" : "font-medium"}>
                  {item.isComponent ? "↳ " : ""}
                  {item.name}
                  <span className="ml-2 text-xs text-[#a1a1aa]">
                    ×{item.quantity} · {money(item.rate)}
                    {RATE_SUFFIX[item.pricingType] ?? ""}
                  </span>
                </span>
                <span className="tabular-nums">
                  {money(item.configuredTotal ?? item.subtotal)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Totals({
  quote,
  shown,
}: {
  quote: QuoteData;
  shown: {
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    deliveryCost: number;
    returnCost: number;
    total: number;
  };
}) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <dl className="ml-auto flex max-w-sm flex-col gap-2 text-sm">
        <Row label="Subtotal" value={money(shown.subtotal)} />
        {shown.discountAmount > 0 ? (
          <Row label="Discount" value={`−${money(shown.discountAmount)}`} />
        ) : null}
        {shown.deliveryCost > 0 ? (
          <Row label="Delivery" value={money(shown.deliveryCost)} />
        ) : null}
        {shown.returnCost > 0 ? (
          <Row label="Return" value={money(shown.returnCost)} />
        ) : null}
        {shown.taxAmount > 0 ? (
          <Row label={`Tax (${quote.taxRate}%)`} value={money(shown.taxAmount)} />
        ) : null}
        <div className="mt-1 flex items-baseline justify-between border-t border-[#e4e4e7] pt-2">
          <dt className="text-base font-bold">Total</dt>
          <dd className="text-base font-bold tabular-nums">{money(shown.total)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-[#71717a]">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#a1a1aa]">{label}</dt>
      <dd className="mt-[2px]">{children}</dd>
    </div>
  );
}

/**
 * Approving is a signature, so it asks for one.
 *
 * The name and the drawn mark are both required and the terms box is not
 * pre-ticked: this is the artifact `generateSignedQuoteDocument` puts on the
 * order, and a signed quote nobody actually signed is worth less than no quote
 * at all.
 */
function ApprovePanel({
  busy,
  onBack,
  onSubmit,
}: {
  busy: boolean;
  onBack: () => void;
  onSubmit: (signerName: string, signature: string) => void;
}) {
  const [signerName, setSignerName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [empty, setEmpty] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canvas = useRef<any>(null);

  function submit() {
    const pad = canvas.current;
    if (!pad || pad.isEmpty?.()) return;
    const signature = (pad.getTrimmedCanvas?.() ?? pad.getCanvas()).toDataURL("image/png");
    onSubmit(signerName.trim(), signature);
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold tracking-tight">Approve and sign</h2>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Your full name</span>
        <input
          value={signerName}
          onChange={(event) => setSignerName(event.target.value)}
          placeholder="As you would sign it"
          className="w-full rounded-lg border border-[#d4d4d8] px-3 py-2.5 text-sm outline-none focus:border-[#18181b]"
        />
      </label>

      <div>
        <span className="mb-1 block text-sm font-medium">Signature</span>
        <div className="overflow-hidden rounded-lg border border-[#d4d4d8] bg-white">
          <SignatureCanvas
            ref={canvas}
            penColor="black"
            onEnd={() => setEmpty(false)}
            canvasProps={{ className: "w-full", style: { width: "100%", height: 150 } }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            canvas.current?.clear();
            setEmpty(true);
          }}
          className="mt-1 text-xs text-[#71717a] hover:text-[#18181b]"
        >
          Clear signature
        </button>
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-[3px] size-4"
        />
        <span className="text-sm text-[#3f3f46]">
          I am authorized to accept this quote on behalf of the company named
          above, and agree to the rental terms and conditions.
        </span>
      </label>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !signerName.trim() || !agreed || empty}
          className="flex-1 rounded-xl bg-[#16a34a] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#15803d] disabled:opacity-50"
        >
          {busy ? "Submitting…" : "Confirm approval"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-[#d4d4d8] px-6 py-2.5 text-sm text-[#52525b] hover:bg-[#fafafa]"
        >
          Back
        </button>
      </div>
    </section>
  );
}

function ReasonPanel({
  kind,
  busy,
  onBack,
  onSubmit,
}: {
  kind: "changes" | "decline";
  busy: boolean;
  onBack: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const changes = kind === "changes";

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold tracking-tight">
        {changes ? "Request changes" : "Decline quote"}
      </h2>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">
          {changes ? "What needs to change" : "Reason, if you would like to give one"}
        </span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          placeholder={
            changes
              ? "e.g. three monitors rather than two, and push the start to the 14th"
              : "Optional — it helps us quote better next time"
          }
          className="w-full resize-none rounded-lg border border-[#d4d4d8] px-3 py-2.5 text-sm outline-none focus:border-[#18181b]"
        />
      </label>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onSubmit(text.trim())}
          disabled={busy || (changes && !text.trim())}
          className={`flex-1 rounded-xl px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
            changes ? "bg-[#18181b] hover:bg-[#27272a]" : "bg-[#dc2626] hover:bg-[#b91c1c]"
          }`}
        >
          {busy ? "Submitting…" : changes ? "Send request" : "Confirm decline"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-[#d4d4d8] px-6 py-2.5 text-sm text-[#52525b] hover:bg-[#fafafa]"
        >
          Back
        </button>
      </div>
    </section>
  );
}

const ANSWERED: Record<Answer, { title: string; blurb: string }> = {
  approved: {
    title: "Approved — thank you",
    blurb:
      "We have your signed approval and the order is now with our team. Your account manager will confirm scheduling shortly.",
  },
  changes: {
    title: "Changes requested",
    blurb:
      "We have your notes and are repricing. A revised quote will follow by email.",
  },
  declined: {
    title: "Quote declined",
    blurb:
      "Thank you for letting us know. If anything changes, reply to the email this came in and we will pick it back up.",
  },
};

function Answered({ answer }: { answer: Answer }) {
  const copy = ANSWERED[answer];
  return (
    <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
      <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
      <p className="mx-auto mt-2 max-w-prose text-sm text-[#71717a]">{copy.blurb}</p>
    </div>
  );
}
