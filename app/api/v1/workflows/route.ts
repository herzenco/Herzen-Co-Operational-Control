import { isApiError, requireMember } from "../../../../utils/api/auth";
import { fail, ok, preflight, readJson } from "../../../../utils/api/responses";
import { validateWorkflowPayload, workflowWritePayload } from "../../../../utils/api/workflows";

export async function GET(request: Request) {
  const context = await requireMember(request);
  if (isApiError(context)) return context;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
  let query = context.supabase
    .from("workflows")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  const status = url.searchParams.get("status");
  const ownerId = url.searchParams.get("owner_id");
  if (status) query = query.eq("status", status);
  if (ownerId) query = query.eq("owner_id", ownerId);

  const { data, error, count } = await query;
  if (error) return fail(500, "database_error", error.message);
  return ok({ items: data, count, limit, offset });
}

export async function POST(request: Request) {
  const context = await requireMember(request, { write: true });
  if (isApiError(context)) return context;
  const body = await readJson(request);
  if (!body) return fail(400, "invalid_json", "Send a JSON workflow definition or { definition } body.");
  const parsed = validateWorkflowPayload(body);
  if (!parsed.success) return fail(422, "workflow_invalid", "The workflow definition is invalid.", { errors: parsed.errors });

  const payload = workflowWritePayload(parsed.definition, context.user!.id, true);
  const { data, error } = await context.supabase.from("workflows").insert(payload).select().single();
  if (error) return fail(error.code === "23505" ? 409 : 400, "write_failed", error.message, { postgres_code: error.code });
  return ok(data, { status: 201 });
}

export const OPTIONS = preflight;
