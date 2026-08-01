import { isApiError, requireMember } from "../../../../utils/api/auth";
import { getResource, pickFields } from "../../../../utils/api/resources";
import { fail, ok, preflight, readJson } from "../../../../utils/api/responses";
import { serializeApiResource } from "../../../../utils/content-assets";

type RouteContext = { params: Promise<{ resource: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { resource: resourceName } = await params;
  const resource = getResource(resourceName);
  if (!resource) return fail(404, "unknown_resource", "That API resource does not exist.");

  const context = await requireMember(request);
  if (isApiError(context)) return context;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
  let query = context.supabase
    .from(resource.table)
    .select("*", { count: "exact" })
    .order(resource.defaultOrder, { ascending: false })
    .range(offset, offset + limit - 1);

  for (const filter of resource.filters) {
    const value = url.searchParams.get(filter);
    if (value !== null) query = query.eq(filter, value);
  }

  const { data, error, count } = await query;
  if (error) return fail(500, "database_error", error.message);
  return ok({ items: serializeApiResource(resourceName, data), count, limit, offset });
}

export async function POST(request: Request, { params }: RouteContext) {
  const { resource: resourceName } = await params;
  const resource = getResource(resourceName);
  if (!resource) return fail(404, "unknown_resource", "That API resource does not exist.");
  if (!resource.mutable) return fail(405, "read_only_resource", "This resource is read-only.");

  const context = await requireMember(request, { write: true });
  if (isApiError(context)) return context;

  const body = await readJson(request);
  if (!body) return fail(400, "invalid_json", "Send a JSON request body.");
  const payload = {
    ...pickFields(body, resource.createFields),
    created_by: context.user.id,
  };

  const { data, error } = await context.supabase
    .from(resource.table)
    .insert(payload)
    .select()
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 400;
    return fail(status, "write_failed", error.message, { postgres_code: error.code });
  }
  return ok(serializeApiResource(resourceName, data), { status: 201 });
}

export const OPTIONS = preflight;
