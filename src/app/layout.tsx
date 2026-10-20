import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";
import { getAppearance } from "@/lib/queries/appearance";
import { getSessionUser } from "@/lib/roles";
import "./globals.css";

const schibstedGrotesk = Schibsted_Grotesk({
  variable: "--font-schibsted-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800", "900"],
  display: "swap",
});

/**
 * Absolute base for the share-card image URLs. Reuses APP_URL / NEXTAUTH_URL,
 * the same variables the emailed links are built from, so a link preview and
 * an email always point at the same host. Unset: development falls back to
 * :3001; production omits it rather than guess a host, in which case Next
 * resolves the image URLs against Vercel's own env or localhost and unfurls
 * will not find the image — set APP_URL once the production host is decided.
 */
function resolveMetadataBase(): URL | undefined {
  const raw = process.env.APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  try {
    if (raw) return new URL(raw);
  } catch {
    // A malformed value is treated as unset.
  }
  return process.env.NODE_ENV === "development"
    ? new URL("http://localhost:3001")
    : undefined;
}

const BRAND = "VFXnow | AMC";
const DESCRIPTION = "Asset management, rental and sales operations for VFXnow.";

// Link previews carry only this static, generic text and the static image
// (opengraph-image.png / twitter-image.png). Nothing here, or in any page's
// metadata, may interpolate customer, order, price or token data: the quote
// portal is the page that gets pasted into chats.
export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  // v1 runs on :3000 under the plain "VFXNow AMC" title. This instance is
  // explicitly v2 so the two are never confused in a tab strip or a bookmark.
  title: {
    default: "VFXNow AMC v2",
    template: "%s \u00b7 AMC v2",
  },
  description: DESCRIPTION,
  applicationName: BRAND,
  openGraph: {
    type: "website",
    siteName: BRAND,
    title: BRAND,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND,
    description: DESCRIPTION,
  },
  // Signed-in app and client portal: never in a search index. Link unfurlers
  // ignore this, so previews still render.
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The user's stored appearance — mode, theme and the three grain axes —
  // falling back to the role default (dark for STAFF, light for admin/finance)
  // and the house palette. The localStorage mirror the pre-paint script reads
  // wins over these, so a choice made on this browser lands before the row
  // does. Both places must be given the same values or the first paint flashes.
  const user = await getSessionUser();
  const appearance = await getAppearance(user?.id, user?.role);

  return (
    <html
      lang="en"
      className={`${schibstedGrotesk.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript appearance={appearance} />
      </head>
      {/* The shell is viewport-height and scrolls internally: the rail has to keep
          its footer — settings, notifications, the user — reachable without
          scrolling the page to find it. `min-h-full` let the body grow with the
          content, which pushed that footer below the fold on any long screen.
          Everything below already expected a bounded height (`min-h-0 flex-1` on
          the shell, `overflow-y-auto` on the nav); this is the one line that was
          not holding up its end. */}
      <body className="h-full overflow-hidden flex flex-col">
        <ThemeProvider appearance={appearance}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
