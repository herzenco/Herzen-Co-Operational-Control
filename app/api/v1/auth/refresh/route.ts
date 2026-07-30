import { createApiClient } from "../../../../../utils/api/auth";
import { fail, ok, preflight, readJson } from "../../../../../utils/api/responses";

export async function POST(request: Request) {
  const body = await readJson(request);
  const refreshToken = String(body?.refresh_token || "");
  if (!refreshToken) {
    return fail(400, "missing_refresh_token", "refresh_token is required.");
  }

  const supabase = createApiClient();
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data.session) {
    return fail(401, "invalid_refresh_token", "The refresh token is invalid or expired.");
  }

  return ok({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    token_type: data.session.token_type,
    expires_at: data.session.expires_at,
    expires_in: data.session.expires_in,
  });
}

export const OPTIONS = preflight;
