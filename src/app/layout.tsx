import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Big_Shoulders } from "next/font/google";
import "./globals.css";

// Body: Atkinson Hyperlegible, drawn for maximum legibility — it has to be read at arm's length in sunlight.
const body = Atkinson_Hyperlegible_Next({ variable: "--ff-body", subsets: ["latin"], display: "swap", adjustFontFallback: false });
// Times and counters.
const mono = Atkinson_Hyperlegible_Mono({ variable: "--ff-mono", subsets: ["latin"], display: "swap", adjustFontFallback: false });
// Display: Big Shoulders, a condensed signage face, for pit-board headings and car numbers.
const display = Big_Shoulders({ variable: "--ff-display", subsets: ["latin"], display: "swap", adjustFontFallback: false });

export const metadata: Metadata = {
  title: { default: "Track Day", template: "%s · Track Day" },
  description: "Schedules, tech inspection, instruction and event operations for PCA driver education weekends.",
  applicationName: "Track Day",
  appleWebApp: { capable: true, title: "Track Day", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#eceef0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${mono.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
