import { NextResponse } from "next/server";
import { createApiClient } from "../../../../utils/api/auth";

const COMPANY_DOMAIN = "herzenco.co";

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const recoverUrl = new URL("/recover", request.url);
  if (!email.endsWith(`@${COMPANY_DOMAIN}`)) {
    recoverUrl.searchParams.set("sent", "1");
    return NextResponse.redirect(recoverUrl, 303);
  }
  const supabase = createApiClient();
  const callbackUrl = new URL("/auth/callback", request.url);
  callbackUrl.searchParams.set("next", "/reset-password");
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl.toString() });
  recoverUrl.searchParams.set(error ? "error" : "sent", "1");
  return NextResponse.redirect(recoverUrl, 303);
}
