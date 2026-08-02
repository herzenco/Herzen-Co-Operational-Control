import { NextResponse } from "next/server";
import { createClient } from "../../../../utils/supabase/server";

export async function POST(request: Request) {
  const formData = await request.formData();
  const password = String(formData.get("password") || "");
  const confirmation = String(formData.get("confirmation") || "");
  if (password.length < 12 || password !== confirmation) return NextResponse.redirect(new URL("/reset-password?error=password", request.url), 303);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/reset-password?error=session", request.url), 303);
  const { data: member } = await supabase.from("operations_members").select("active").eq("user_id", user.id).eq("active", true).single();
  if (!member) return NextResponse.redirect(new URL("/reset-password?error=session", request.url), 303);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return NextResponse.redirect(new URL("/reset-password?error=password", request.url), 303);
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login?recovered=1", request.url), 303);
}
