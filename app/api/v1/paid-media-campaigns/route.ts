import { isApiError, requireMember } from "../../../../utils/api/auth";
import { fail, ok, preflight } from "../../../../utils/api/responses";

export async function GET(request: Request) {
  const context = await requireMember(request);
  if (isApiError(context)) return context;
  const { data, error } = await context.supabase.from("paid_media_campaigns").select("*").order("updated_at", { ascending: false });
  if (error) return fail(500, "database_error", error.message);
  return ok({ items: data || [] });
}
export const OPTIONS = preflight;
