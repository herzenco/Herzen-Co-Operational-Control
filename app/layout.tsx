import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./aegis.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: "Lupe — Herzen Co. Operations",
    description: "Agent operations, instructions, approvals, and daily updates for Herzen Co.",
    icons: { icon: "/herzen-icon.png", shortcut: "/herzen-icon.png", apple: "/herzen-icon.png" },
    openGraph: {
      title: "Herzen Co. Agent Operations",
      description: "Work in motion.",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Herzen Co. Agent Operations" }],
    },
    twitter: { card: "summary_large_image", title: "Herzen Co. Agent Operations", description: "Work in motion.", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
