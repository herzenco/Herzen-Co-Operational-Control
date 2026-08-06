import type { NextRequest } from "next/server";
import { enforcePreviewBoundary } from "./utils/preview-boundary";
import { updateSession } from "./utils/supabase/middleware";

export async function proxy(request: NextRequest) {
  const previewBoundary = enforcePreviewBoundary(request);
  if (previewBoundary) return previewBoundary;
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
