import { isApiError, requireMember } from "../../../../../utils/api/auth";
import { getResource, pickFields } from "../../../../../utils/api/resources";
import { fail, ok, preflight, readJson } from "../../../../../utils/api/responses";

type RouteContext = { params: Promise<{ resource: string; id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { resource: resourceName, id } = await params;
  const resource = getResource(resourceName);
  if (!resource) return fail(404, "unknown_resource", "That API resource does not exist.");

  const context = await requireMember(request);
  if (isApiError(context)) return context;
  const { data, error } = await context.supabase
    .from(resource.table)
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return fail(404, "not_found", "The requested record was not found.");
  return ok(data);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { resource: resourceName, id } = await params;
  const resource = getResource(resourceName);
  if (!resource) return fail(404, "unknown_resource", "That API resource does not exist.");
  if (!resource.mutable) return fail(405, "read_only_resource", "This resource is read-only.");

  const context = await requireMember(request, { write: true });
  if (isApiError(context)) return context;
  const body = await readJson(request);
  if (!body) return fail(400, "invalid_json", "Send a JSON request body.");

  const payload = pickFields(body, resource.updateFields);
  if (resourceName === "tasks" && body.status === "done" && !body.completed_at) {
    payload.completed_at = new Date().toISOString();
  }
  if (resourceName === "approvals" && body.status && body.status !== "pending") {
    payload.decided_by = context.user.id;
    payload.decided_at = new Date().toISOString();
  }

  const { data, error } = await context.supabase
    .from(resource.table)
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error || !data) return fail(400, "write_failed", error?.message || "The record could not be updated.");

  if (resourceName === "approvals" && data.content_item_id && body.status && body.status !== "pending") {
    const contentUpdate =
      body.status === "approved"
        ? {
            status: "approved",
            approved_by: context.user.id,
            approved_at: new Date().toISOString(),
            approval_id: data.id,
          }
        : body.status === "changes_requested"
          ? {
              status: "revision_requested",
              approved_by: null,
              approved_at: null,
              approval_id: data.id,
            }
          : {
              status: "cancelled",
              approved_by: null,
              approved_at: null,
              approval_id: data.id,
            };

    const { error: contentError } = await context.supabase
      .from("content_items")
      .update(contentUpdate)
      .eq("id", data.content_item_id);

    if (contentError) {
      return fail(409, "content_sync_failed", contentError.message, {
        approval_id: data.id,
        approval_status: data.status,
      });
    }
  }

  return ok(data);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { resource: resourceName, id } = await params;
  const resource = getResource(resourceName);
  if (!resource) return fail(404, "unknown_resource", "That API resource does not exist.");
  if (!resource.mutable) return fail(405, "read_only_resource", "This resource is read-only.");

  const context = await requireMember(request, { write: true });
  if (isApiError(context)) return context;
  const { data, error } = await context.supabase
    .from(resource.table)
    .delete()
    .eq("id", id)
    .select()
    .single();
  if (error || !data) return fail(409, "delete_failed", error?.message || "The record could not be deleted.");
  return ok({ deleted: data });
}

export const OPTIONS = preflight;
