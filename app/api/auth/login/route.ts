import { NextResponse } from "next/server";
import { createClient } from "../../../../utils/supabase/server";

const COMPANY_EMAIL_DOMAIN = "herzen.co";

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const isCompanyEmail =
    email.endsWith(`@${COMPANY_EMAIL_DOMAIN}`) &&
    email.length > COMPANY_EMAIL_DOMAIN.length + 1;

  if (!isCompanyEmail || !password) {
    return NextResponse.redirect(new URL("/login?error=credentials", request.url), 303);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=credentials", request.url), 303);
  }

  return NextResponse.redirect(new URL("/", request.url), 303);
}
