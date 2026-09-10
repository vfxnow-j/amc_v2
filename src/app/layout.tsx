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

export const metadata: Metadata = {
  // v1 runs on :3000 under the plain "VFXNow AMC" title. This instance is
  // explicitly v2 so the two are never confused in a tab strip or a bookmark.
  title: {
    default: "VFXNow AMC v2",
    template: "%s · AMC v2",
  },
  description: "Asset management, rental and sales operations for VFXNow.",
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
