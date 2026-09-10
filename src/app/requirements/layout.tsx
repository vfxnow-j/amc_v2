import Image from "next/image";
import { Plus_Jakarta_Sans } from "next/font/google";

/**
 * The chrome around the documents portal.
 *
 * A sibling of `app/quote/layout.tsx` and deliberately identical in feel: both
 * are reached by a link with a token in it, by somebody with no session and no
 * stored preference, and the two arrive in the same thread days apart. Fixed
 * colours and the warmer client-facing typeface for the same reason set out
 * there — the six staff themes are a preference staff set for themselves, and a
 * document that renders dark for one recipient and light for another is a
 * different document each time.
 *
 * Kept as its own layout rather than shared with `/quote`: a quote is a
 * commercial offer and this is a paperwork errand, and the moment either one
 * needs a line of copy the other does not, a shared layout becomes a prop.
 */
const portalSans = Plus_Jakarta_Sans({
  variable: "--font-portal-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata = { title: "Documents" };

export default function RequirementsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${portalSans.variable} flex min-h-screen flex-col bg-[#f4f4f5] font-[family-name:var(--font-portal-sans)] text-[#18181b] antialiased`}
    >
      <header className="bg-[#18181b] text-white">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-4">
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

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t border-[#e4e4e7] bg-white">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-between gap-2 px-4 py-5 sm:flex-row">
          <span className="text-xs text-[#a1a1aa]">
            VFXNow Asset Management &amp; Control
          </span>
          <span className="text-xs text-[#d4d4d8]">
            Anything you send here is held against your account only.
          </span>
        </div>
      </footer>
    </div>
  );
}
