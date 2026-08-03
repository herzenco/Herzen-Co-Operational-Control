import { isApiError, requireMember } from "../../../../../utils/api/auth";
import { fail, ok, preflight, readJson } from "../../../../../utils/api/responses";
import { validateWorkflowPayload, workflowWritePayload } from "../../../../../utils/api/workflows";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const context = await requireMember(request);
  if (isApiError(context)) return context;
  const { data, error } = await context.supabase.from("workflows").select("*").eq("id", id).single();
  if (error || !data) return fail(404, "not_found", "The requested workflow was not found.");
  return ok(data);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const context = await requireMember(request, { write: true });
  if (isApiError(context)) return context;
  const body = await readJson(request);
  if (!body) return fail(400, "invalid_json", "Send a JSON workflow definition or { definition } body.");
  const parsed = validateWorkflowPayload(body);
  if (!parsed.success) return fail(422, "workflow_invalid", "The workflow definition is invalid.", { errors: parsed.errors });
  if (parsed.definition.id !== id) return fail(409, "id_mismatch", "The workflow definition id must match the URL id.");

  const payload = workflowWritePayload(parsed.definition, context.user!.id, false);
  const { data, error } = await context.supabase.from("workflows").update(payload).eq("id", id).select().single();
  if (error || !data) return fail(400, "write_failed", error?.message || "The workflow could not be updated.");
  return ok(data);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const context = await requireMember(request, { write: true });
  if (isApiError(context)) return context;
  const { data, error } = await context.supabase.from("workflows").delete().eq("id", id).select().single();
  if (error || !data) return fail(409, "delete_failed", error?.message || "The workflow could not be deleted.");
  return ok({ deleted: data });
}

export const OPTIONS = preflight;
