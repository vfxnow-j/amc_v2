"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type {
  RequirementKind,
  RequirementsPortal as PortalData,
} from "@/lib/requirements/token";

// Same treatment as the quote portal: react-signature-canvas touches
// `document` at import, so it can only load in the browser, and its ref shape
// is the package's own — pinning a type here buys nothing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SignatureCanvas = dynamic(() => import("react-signature-canvas") as any, {
  ssr: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

/**
 * The customer's side of ID, insurance and the rental agreement.
 *
 * Every write leaves through `fetch` to a route handler under
 * `/api/requirements/[token]/`, never a Server Function. The upload route's own
 * header explains the size arithmetic; the consequence for this component is
 * that it holds real `File` objects and posts multipart form data, and never
 * base64s anything.
 *
 * It also shrinks photos before sending. A phone camera writes 4–8 MB for a
 * picture of a laminated card, and the readable part of that is perhaps 200 KB
 * — so an image is redrawn at a 2000px bound and re-encoded as JPEG in the
 * browser first. That is not only about the ceiling: it is the difference
 * between a two-second upload and a two-minute one on a phone in a car park,
 * which is where these are actually done. Anything the browser cannot decode —
 * HEIC in Chrome, a PDF — is sent exactly as it came.
 *
 * Nothing here is optimistic. A slot goes green because the server said it
 * filed the document, and `router.refresh()` re-reads the account rather than
 * this component guessing at what the upload changed.
 */

const COPY: Record<
  RequirementKind,
  { title: string; blurb: string; done: string }
> = {
  ID: {
    title: "Photo ID",
    blurb:
      "A driving licence or passport. Both sides of a licence — a passport's photo page is enough on its own, so send the same page twice if that is what you have.",
    done: "We have your ID.",
  },
  COI: {
    title: "Certificate of insurance",
    blurb:
      "The certificate from your insurer or broker, as a PDF or a photo. It needs to be current and to cover the equipment you are hiring.",
    done: "We have your certificate of insurance.",
  },
  AGREEMENT: {
    title: "Rental agreement",
    blurb: "Read it through, then sign at the bottom.",
    done: "The agreement is signed.",
  },
};

export function RequirementsPortal({
  token,
  portal,
}: {
  token: string;
  portal: PortalData;
}) {
  const router = useRouter();
  const asked = portal.rows.filter((row) => row.asked);
  const done = portal.outstanding.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight">
          {done ? "Thank you — that is everything" : "A few documents, please"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#52525b]">
          {done ? (
            <>
              We have everything we asked {portal.companyName ?? portal.clientName}{" "}
              for. There is nothing left to do here — you can close this page.
            </>
          ) : (
            <>
              Before we can send equipment out to{" "}
              {portal.companyName ?? portal.clientName}, we need the{" "}
              {portal.outstanding.length === 1 ? "item" : "items"} below. Each one
              saves as soon as you send it, so you can come back to this link and
              finish later.
            </>
          )}
        </p>
        <p className="mt-3 text-xs text-[#a1a1aa]">
          This link is good until {longDay(portal.expiresAt)}.
        </p>
      </header>

      {asked.map((row) => {
        if (row.settled) return <Settled key={row.kind} kind={row.kind} at={row.at} waived={row.waived} />;
        if (row.kind === "AGREEMENT") {
          return (
            <AgreementPanel
              key={row.kind}
              token={token}
              hasTemplate={portal.hasTemplate}
              onDone={() => router.refresh()}
            />
          );
        }
        return (
          <UploadPanel
            key={row.kind}
            token={token}
            kind={row.kind}
            idOnFile={portal.idOnFile}
            onDone={() => router.refresh()}
          />
        );
      })}

      <p className="px-1 text-xs leading-relaxed text-[#a1a1aa]">
        What you send is stored against your account and used to complete your
        file. If something here looks wrong — a document you have already sent,
        or an account name you do not recognise — reply to the email this link
        came in rather than uploading anything.
      </p>
    </div>
  );
}

/** A requirement with nothing left to do. Stated, not hidden. */
function Settled({
  kind,
  at,
  waived,
}: {
  kind: RequirementKind;
  at: string | null;
  waived: boolean;
}) {
  return (
    <section className="rounded-2xl border border-[#d4d4d8] bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold tracking-tight">{COPY[kind].title}</h2>
        <span className="text-xs font-semibold text-[#15803d]">Done</span>
      </div>
      <p className="mt-1 text-sm text-[#52525b]">
        {waived
          ? "We have agreed you do not need to send this."
          : `${COPY[kind].done}${at ? ` Received ${longDay(at)}.` : ""}`}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

type SlotState = { status: "idle" | "sending" | "done" | "error"; message?: string };

function UploadPanel({
  token,
  kind,
  idOnFile,
  onDone,
}: {
  token: string;
  kind: "ID" | "COI";
  idOnFile: { front: boolean; back: boolean };
  onDone: () => void;
}) {
  const slots: { type: "ID_FRONT" | "ID_BACK" | "COI"; label: string; already: boolean }[] =
    kind === "ID"
      ? [
          { type: "ID_FRONT", label: "Front", already: idOnFile.front },
          { type: "ID_BACK", label: "Back", already: idOnFile.back },
        ]
      : [{ type: "COI", label: "Certificate", already: false }];

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold tracking-tight">{COPY[kind].title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-[#52525b]">
        {COPY[kind].blurb}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {slots.map((slot) => (
          <Slot
            key={slot.type}
            token={token}
            type={slot.type}
            label={slot.label}
            already={slot.already}
            onDone={onDone}
          />
        ))}
      </div>

      <p className="mt-3 text-xs text-[#a1a1aa]">
        JPEG, PNG, HEIC or PDF, up to 8 MB each. Photos are shrunk on this device
        before they are sent.
      </p>
    </section>
  );
}

function Slot({
  token,
  type,
  label,
  already,
  onDone,
}: {
  token: string;
  type: "ID_FRONT" | "ID_BACK" | "COI";
  label: string;
  already: boolean;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<SlotState>(
    already ? { status: "done", message: "Already received" } : { status: "idle" },
  );

  async function send(file: File) {
    setState({ status: "sending" });
    const body = new FormData();
    body.set("type", type);
    const shrunk = await shrinkImage(file);
    body.set("file", shrunk, shrunk.name);

    try {
      const response = await fetch(`/api/requirements/${token}/upload`, {
        method: "POST",
        body,
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setState({
          status: "error",
          message:
            payload?.error ?? "That did not go through. Please try it again.",
        });
        return;
      }

      setState({ status: "done", message: "Sent" });
      onDone();
    } catch {
      // A dropped connection on a phone, almost always. Nothing was written.
      setState({
        status: "error",
        message:
          "That did not reach us — check your connection and try it again.",
      });
    }
  }

  const tone =
    state.status === "done"
      ? "border-[#15803d] bg-[#f0fdf4]"
      : state.status === "error"
        ? "border-[#b91c1c] bg-[#fef2f2]"
        : "border-[#d4d4d8] bg-[#fafafa]";

  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        {state.status === "done" ? (
          <span className="text-xs font-semibold text-[#15803d]">
            {state.message}
          </span>
        ) : null}
      </div>

      {state.status === "error" && state.message ? (
        <p role="alert" className="mt-1 text-xs text-[#b91c1c]">
          {state.message}
        </p>
      ) : null}

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared before the send so choosing the same file twice — after a
          // failure, which is exactly when somebody does — still fires.
          event.target.value = "";
          if (file) void send(file);
        }}
      />

      <button
        type="button"
        disabled={state.status === "sending"}
        onClick={() => input.current?.click()}
        className="mt-2 w-full rounded-lg bg-[#18181b] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {state.status === "sending"
          ? "Sending…"
          : state.status === "done"
            ? "Send a different one"
            : "Choose a file"}
      </button>
    </div>
  );
}

/**
 * Redraw a photo at a sane size before it leaves the phone.
 *
 * Every failure path returns the original file untouched — an unreadable
 * format, a canvas the browser will not give up (Safari taints a very large
 * one), a re-encode that came out bigger than what went in. Shrinking is a
 * courtesy, and a courtesy that can lose somebody's document is not one.
 */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size < 400_000) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const bound = 2000;
    const scale = Math.min(1, bound / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob || blob.size >= file.size) return file;

    const stem = file.name.replace(/\.[^./\\]+$/, "") || "document";
    return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// ---------------------------------------------------------------------------
// The agreement
// ---------------------------------------------------------------------------

/**
 * Read and sign.
 *
 * With no template configured this panel says so plainly instead of offering a
 * pen. That is the state of this instance today — the templates directory was
 * not carried across in the refresh from v1 — and a signature box that cannot
 * produce a signed document would take a customer's name and give nothing back.
 */
function AgreementPanel({
  token,
  hasTemplate,
  onDone,
}: {
  token: string;
  hasTemplate: boolean;
  onDone: () => void;
}) {
  const [signerName, setSignerName] = useState("");
  const [empty, setEmpty] = useState(true);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canvas = useRef<any>(null);

  if (!hasTemplate) {
    return (
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold tracking-tight">
          {COPY.AGREEMENT.title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-[#52525b]">
          The agreement is not ready to sign here yet. We will send it across
          separately — nothing is needed from you on this page for it, and
          anything else above can still be sent now.
        </p>
      </section>
    );
  }

  function submit() {
    const pad = canvas.current;
    if (!pad || pad.isEmpty?.()) {
      setError("Draw your signature in the box first.");
      return;
    }
    if (signerName.trim().length < 2) {
      setError("Type the name of the person signing.");
      return;
    }
    const signature = (pad.getTrimmedCanvas?.() ?? pad.getCanvas()).toDataURL(
      "image/png",
    );

    setError("");
    startTransition(async () => {
      try {
        const response = await fetch(`/api/requirements/${token}/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signerName: signerName.trim(), signature }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!response.ok) {
          setError(payload?.error ?? "That did not go through. Try again.");
          return;
        }
        onDone();
      } catch {
        setError("That did not reach us — check your connection and try again.");
      }
    });
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold tracking-tight">
        {COPY.AGREEMENT.title}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-[#52525b]">
        {COPY.AGREEMENT.blurb}
      </p>

      <a
        href={`/api/requirements/${token}/agreement`}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block rounded-lg border border-[#d4d4d8] px-3 py-2 text-sm font-semibold hover:border-[#18181b]"
      >
        Read the agreement
      </a>

      <label className="mt-4 block">
        <span className="mb-1 block text-sm font-medium">Your full name</span>
        <input
          value={signerName}
          onChange={(event) => setSignerName(event.target.value)}
          placeholder="As you would sign it"
          className="w-full rounded-lg border border-[#d4d4d8] px-3 py-2.5 text-sm outline-none focus:border-[#18181b]"
        />
      </label>

      <div className="mt-3">
        <span className="mb-1 block text-sm font-medium">Signature</span>
        <div className="rounded-lg border border-[#d4d4d8] bg-white">
          <SignatureCanvas
            ref={canvas}
            penColor="black"
            onEnd={() => setEmpty(false)}
            canvasProps={{
              className: "w-full",
              style: { width: "100%", height: 150 },
            }}
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

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[#b91c1c]">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy || empty || signerName.trim().length < 2}
        onClick={submit}
        className="mt-4 w-full rounded-lg bg-[#18181b] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Recording…" : "Sign the agreement"}
      </button>
    </section>
  );
}

function longDay(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
