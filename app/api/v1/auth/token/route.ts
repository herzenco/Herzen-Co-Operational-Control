import { createApiClient } from "../../../../../utils/api/auth";
import { fail, ok, preflight, readJson } from "../../../../../utils/api/responses";

const COMPANY_DOMAIN = "herzenco.co";

export async function POST(request: Request) {
  const body = await readJson(request);
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  if (!email.endsWith(`@${COMPANY_DOMAIN}`) || !password) {
    return fail(401, "invalid_credentials", "A valid Herzen Co. identity is required.");
  }

  const supabase = createApiClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    return fail(401, "invalid_credentials", "The supplied identity could not be authenticated.");
  }

  const scopedClient = createApiClient(data.session.access_token);
  const { data: member, error: memberError } = await scopedClient
    .from("operations_members")
    .select("display_name,role,active,permissions")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .single();

  if (memberError || !member) {
    await supabase.auth.signOut();
    return fail(403, "not_a_member", "This identity is not an active Operations Control member.");
  }

  return ok({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    token_type: data.session.token_type,
    expires_at: data.session.expires_at,
    expires_in: data.session.expires_in,
    member,
  });
}

export const OPTIONS = preflight;
