import { NextResponse } from "next/server";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function enforcePreviewBoundary(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return null;

  const pathname = new URL(request.url).pathname;
  const isExternalAction =
    pathname === "/api/cron/content-automation" ||
    pathname.startsWith("/api/integrations/") ||
    pathname.includes("/content-automation/") ||
    pathname.includes("/linkedin-publication");
  const isApiMutation = pathname.startsWith("/api/") && !safeMethods.has(request.method.toUpperCase());

  if (!isExternalAction && !isApiMutation) return null;

  return NextResponse.json(
    { error: { message: "Preview deployments are read-only and cannot access production mutations or external actions." } },
    { status: 403 },
  );
}
