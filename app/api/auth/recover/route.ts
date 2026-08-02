import { NextResponse } from "next/server";
import { createApiClient } from "../../../../utils/api/auth";

const COMPANY_DOMAIN = "herzenco.co";
const PRODUCTION_ORIGIN = "https://operations.herzenco.co";

export function publicRequestOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestUrl = new URL(request.url);
  if (forwardedHost === "operations.herzenco.co" || forwardedHost?.endsWith(".vercel.app")) {
    return `https://${forwardedHost}`;
  }
  if (["localhost", "127.0.0.1"].includes(requestUrl.hostname)) return requestUrl.origin;
  return PRODUCTION_ORIGIN;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const origin = publicRequestOrigin(request);
  const recoverUrl = new URL("/recover", origin);
  if (!email.endsWith(`@${COMPANY_DOMAIN}`)) {
    recoverUrl.searchParams.set("sent", "1");
    return NextResponse.redirect(recoverUrl, 303);
  }
  const supabase = createApiClient();
  const callbackUrl = new URL("/auth/callback", origin);
  callbackUrl.searchParams.set("next", "/reset-password");
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl.toString() });
  recoverUrl.searchParams.set(error ? "error" : "sent", "1");
  return NextResponse.redirect(recoverUrl, 303);
}
