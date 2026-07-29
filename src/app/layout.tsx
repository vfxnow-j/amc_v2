import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";
import "./globals.css";

const schibstedGrotesk = Schibsted_Grotesk({
  variable: "--font-schibsted-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "VFXNow AMC",
  description: "Asset management, rental and sales operations for VFXNow.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${schibstedGrotesk.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">
        {/* `defaultPreference` becomes the User record's theme (falling back to
            the role default: dark for STAFF, light for admin/finance) once auth
            lands; the same value must be passed to ThemeScript above. */}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
