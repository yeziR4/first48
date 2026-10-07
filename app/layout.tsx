import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "First 48 — be early, not applicant #900",
  description: "Live jobs, hackathons and bounties from the source, ranked by fit and freshness. Powered by TinyFish Search, Fetch and Agent.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
