import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";
import { getAppearance } from "@/lib/queries/appearance";
import { getSessionUser } from "@/lib/roles";
import { THEMES } from "@/lib/theme";
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
  // The user's stored mode and theme, falling back to the role default —
  // dark for STAFF, light for admin/finance — and the house palette. The
  // localStorage mirror the pre-paint script reads wins over these, so a choice
  // made on this browser lands before the row does. Both places must be given
  // the same values or the first paint flashes.
  const user = await getSessionUser();
  const { mode, theme } = await getAppearance(user?.id, user?.role);

  return (
    <html
      lang="en"
      className={`${schibstedGrotesk.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript
          defaultMode={mode}
          defaultTheme={theme}
          themes={THEMES.map((option) => option.id)}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider defaultMode={mode} defaultTheme={theme}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
