import { isApiError, requireMember } from "../../../../../../utils/api/auth";
import { fail, ok, preflight } from "../../../../../../utils/api/responses";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const context = await requireMember(request);
  if (isApiError(context)) return context;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
  const { data, error, count } = await context.supabase
    .from("workflow_versions")
    .select("*", { count: "exact" })
    .eq("workflow_id", id)
    .order("version", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return fail(500, "database_error", error.message);
  return ok({ items: data, count, limit, offset });
}

export const OPTIONS = preflight;
