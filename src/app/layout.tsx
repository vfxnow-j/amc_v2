import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";
import { defaultThemeFor, getSessionUser } from "@/lib/roles";
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
  // The role default — dark for STAFF, light for admin/finance — is what a user
  // gets before they've picked a theme. A picked theme lives in the localStorage
  // mirror the pre-paint script reads, so it wins over this. Both places must be
  // given the same value or the first paint flashes.
  const user = await getSessionUser();
  const theme = defaultThemeFor(user?.role);

  return (
    <html
      lang="en"
      className={`${schibstedGrotesk.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript defaultTheme={theme} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider defaultPreference={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
