import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "FantasyFootballMind",
  description: "A GM brain for your Sleeper league: Trade Central, Line-Up Guru and Waiver Wire Wizard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-line bg-panel/60 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Fantasy<span className="text-accent">Football</span>Mind
            </Link>
            <span className="text-xs text-muted">Sleeper · FantasyCalc · DynastyProcess · ESPN · nflverse · Vegas</span>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
