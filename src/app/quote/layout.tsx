import Image from "next/image";
import { Plus_Jakarta_Sans } from "next/font/google";

/**
 * The online quote, as the client sees it.
 *
 * Outside every route group on purpose. `(shell)` assumes a session and paints
 * the rail; `(auth)` assumes someone is trying to get one. This is neither —
 * it is a document sent to a person outside the business, reached by a link
 * with a token in it and nothing else.
 *
 * It is also the one surface in v2 that does not follow the app's theming. The
 * six themes are a preference the staff set for themselves; a client opening a
 * quote has no session and no preference, and a quote that rendered dark for
 * one recipient and light for another would be a different document each time.
 * So the colors here are fixed and stated in full, and the typeface is the
 * warmer one v1 chose for client-facing documents rather than the dashboard's.
 */
const quoteSans = Plus_Jakarta_Sans({
  variable: "--font-quote-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata = { title: "Quote" };

export default function QuoteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${quoteSans.variable} flex min-h-screen flex-col bg-[#f4f4f5] font-[family-name:var(--font-quote-sans)] text-[#18181b] antialiased`}
    >
      <header className="bg-[#18181b] text-white">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-4">
          <Image
            src="/brand/VFXnow-Logo-AllWhite-Vector.png"
            alt="VFXNow"
            width={112}
            height={28}
            className="h-7 w-auto"
            priority
          />
          <span className="text-[11px] leading-tight text-[#a1a1aa]">
            Asset Management &amp; Control
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t border-[#e4e4e7] bg-white">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-between gap-2 px-4 py-5 sm:flex-row">
          <span className="text-xs text-[#a1a1aa]">
            VFXNow Asset Management &amp; Control
          </span>
          <span className="text-xs text-[#d4d4d8]">
            Questions about this quote? Reply to the email it came in.
          </span>
        </div>
      </footer>
    </div>
  );
}
