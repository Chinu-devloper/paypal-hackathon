import type { Metadata } from "next";
import { AmbientBackground } from "@/components/motion";
import { THEME_INIT_SCRIPT } from "@/shared/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayPal MilestoneOS",
  description: "Autonomous AI-verified escrow, equipment procurement, and milestone payouts on PayPal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <AmbientBackground />
        {children}
      </body>
    </html>
  );
}
