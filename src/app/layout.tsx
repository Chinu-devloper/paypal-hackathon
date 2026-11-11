import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayPal MilestoneOS",
  description: "Autonomous AI-verified escrow, equipment procurement, and milestone payouts on PayPal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
