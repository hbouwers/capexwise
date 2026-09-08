import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// components.md §12. Both families at 400/500/600 — the prototype uses the sans
// at 500 nineteen times and at 600 twenty-six, and the system stack it was drawn
// against has neither weight on Windows. next/font self-hosts the files, so
// nothing is fetched from Google at runtime.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CapExWise",
  description: "Capital planning for small residential landlords.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${plexSans.variable} ${plexMono.variable}`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
