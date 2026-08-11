import { NextResponse } from "next/server";
import { createClient } from "../../../../utils/supabase/server";

const COMPANY_EMAIL_DOMAIN = "herzenco.co";

function safeNext(value: FormDataEntryValue | null) {
  const next = String(value || "/");
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const next = safeNext(formData.get("next"));
  const isCompanyEmail =
    email.endsWith(`@${COMPANY_EMAIL_DOMAIN}`) &&
    email.length > COMPANY_EMAIL_DOMAIN.length + 1;

  if (!isCompanyEmail || !password) {
    return NextResponse.redirect(new URL(`/login?error=credentials&next=${encodeURIComponent(next)}`, request.url), 303);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const reason = error.code === "email_not_confirmed" ? "confirmation" : "credentials";
    return NextResponse.redirect(new URL(`/login?error=${reason}&next=${encodeURIComponent(next)}`, request.url), 303);
  }

  return NextResponse.redirect(new URL(next, request.url), 303);
}
