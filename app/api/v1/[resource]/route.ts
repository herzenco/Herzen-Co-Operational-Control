import { isApiError, requireMember } from "../../../../utils/api/auth";
import { getResource, pickFields } from "../../../../utils/api/resources";
import { fail, ok, preflight, readJson } from "../../../../utils/api/responses";
import { serializeApiResource } from "../../../../utils/content-assets";
import { normalizeContentWrite } from "../../../../utils/content-write";
import { resolveContentPropertyScope } from "../../../../utils/api/content-property-scope";

type RouteContext = { params: Promise<{ resource: string }> };

const machineWritableResources = new Set([
  "tasks",
  "content-items",
  "content-assets",
  "agent-work-items",
  "agent-work-dependencies",
  "content-feedback",
]);

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

  if (resourceName === "content-items") {
    const scope = await resolveContentPropertyScope(url.searchParams, async (slug) => {
      const { data, error } = await context.supabase.from("content_properties").select("id").eq("slug", slug).maybeSingle();
      if (error) throw error;
      return data?.id ? String(data.id) : null;
    }).catch((error: unknown) => ({
      propertyId: null,
      error: { code: "property_lookup_failed" as const, message: error instanceof Error ? error.message : "Could not resolve the OCC property." },
    }));
    if (scope.error) {
      const status = scope.error.code === "unknown_property" ? 404 : scope.error.code === "property_lookup_failed" ? 500 : 400;
      return fail(status, scope.error.code, scope.error.message);
    }
    if (scope.propertyId) query = query.eq("property_id", scope.propertyId);
  }

  for (const filter of resource.filters) {
    if (resourceName === "content-items" && filter === "property_id") continue;
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

  const context = await requireMember(request, {
    write: true,
    allowAgentWrite: machineWritableResources.has(resourceName),
  });
  if (isApiError(context)) return context;

  const body = await readJson(request);
  if (!body) return fail(400, "invalid_json", "Send a JSON request body.");
  let payload: Record<string, unknown> = {
    ...pickFields(body, resource.createFields),
    ...(context.user ? { created_by: context.user.id } : {}),
  };
  if (context.agentId && resourceName === "work-logs" && !payload.agent_id) payload.agent_id = context.agentId;
  if (context.agentId && resourceName === "daily-updates" && !payload.agent_id) payload.agent_id = context.agentId;
  if (context.agentId && resourceName === "approvals" && !payload.requested_by_agent_id) payload.requested_by_agent_id = context.agentId;
  if (resourceName === "content-items") {
    const normalized = normalizeContentWrite(payload);
    if (normalized.error) return fail(422, "unhosted_creative", normalized.error);
    payload = normalized.payload;
  }

  const { data, error } = await context.supabase
    .from(resource.table)
    .insert(payload)
    .select()
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 400;
    return fail(status, "write_failed", error.message, { postgres_code: error.code });
  }
  if (context.agentId) {
    await context.supabase.from("activity_log").insert({
      actor_user_id: null,
      action: "agent_insert",
      entity_type: resource.table,
      entity_id: String(data.id),
      after_data: { agent_id: context.agentId, credential_id: context.credentialId },
    });
  }
  return ok(serializeApiResource(resourceName, data), { status: 201 });
}

export const OPTIONS = preflight;
