import { isApiError, requireMember } from "../../../../../utils/api/auth";
import { getResource, pickFields } from "../../../../../utils/api/resources";
import { fail, ok, preflight, readJson } from "../../../../../utils/api/responses";
import { serializeApiResource } from "../../../../../utils/content-assets";
import { normalizeContentWrite } from "../../../../../utils/content-write";

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
  return ok(serializeApiResource(resourceName, data));
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { resource: resourceName, id } = await params;
  const resource = getResource(resourceName);
  if (!resource) return fail(404, "unknown_resource", "That API resource does not exist.");
  if (!resource.mutable) return fail(405, "read_only_resource", "This resource is read-only.");

  const context = await requireMember(request, {
    write: true,
    allowAgentWrite: ["content-items", "content-assets", "agent-work-items", "agent-work-dependencies", "content-feedback"].includes(resourceName),
  });
  if (isApiError(context)) return context;
  const body = await readJson(request);
  if (!body) return fail(400, "invalid_json", "Send a JSON request body.");

  let payload = pickFields(body, resource.updateFields);
  if (resourceName === "content-items") {
    const { data: current, error: currentError } = await context.supabase
      .from(resource.table)
      .select("caption,creative_asset_path,metadata")
      .eq("id", id)
      .single();
    if (currentError || !current) return fail(404, "not_found", "The requested record was not found.");
    const normalized = normalizeContentWrite({ ...current, ...payload });
    if (normalized.error) return fail(422, "unhosted_creative", normalized.error);
    payload = { ...payload, caption: normalized.payload.caption };
  }
  if (resourceName === "tasks" && body.status === "done" && !body.completed_at) {
    payload.completed_at = new Date().toISOString();
  }
  if (resourceName === "approvals" && body.status && body.status !== "pending") {
    if (["changes_requested", "declined"].includes(String(body.status)) && !String(body.decision_note || "").trim()) {
      return fail(422, "rejection_reason_required", "A written rejection reason is required for Lupe and the content owner.");
    }
    payload.decided_by = context.user.id;
    payload.decided_at = new Date().toISOString();
  }
  if (resourceName === "content-feedback" && body.status === "applied") {
    payload.applied_at = body.applied_at || new Date().toISOString();
  }

  const { data, error } = await context.supabase
    .from(resource.table)
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error || !data) return fail(400, "write_failed", error?.message || "The record could not be updated.");

  if (resourceName === "approvals" && data.content_item_id && body.status && body.status !== "pending") {
    const { data: canonicalContent } = await context.supabase
      .from("content_items")
      .select("caption,body,source_asset_id,delivery_asset_id")
      .eq("id", data.content_item_id)
      .single();
    const contentUpdate =
      body.status === "approved"
        ? {
            status: body.schedule_content === true ? "scheduled" : "approved",
            approval_state: "approved",
            approved_by: context.user.id,
            approved_at: new Date().toISOString(),
            approval_id: data.id,
            package_manifest: canonicalContent ? {
              caption: canonicalContent.caption || canonicalContent.body,
              source_asset_id: canonicalContent.source_asset_id,
              delivery_asset_id: canonicalContent.delivery_asset_id,
            } : {},
          }
        : body.status === "changes_requested"
          ? {
              status: "revision_requested",
              approval_state: "changes_requested",
              approved_by: null,
              approved_at: null,
              approval_id: data.id,
            }
          : {
              status: "cancelled",
              approval_state: "declined",
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

  if (resourceName === "content-feedback" && data.content_item_id && body.status) {
    const { data: item } = await context.supabase.from("content_items").select("feedback_version").eq("id", data.content_item_id).single();
    if (item) await context.supabase.from("content_items").update({ feedback_version: Number(item.feedback_version || 0) + 1 }).eq("id", data.content_item_id);
  }

  return ok(serializeApiResource(resourceName, data));
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { resource: resourceName, id } = await params;
  const resource = getResource(resourceName);
  if (!resource) return fail(404, "unknown_resource", "That API resource does not exist.");
  if (!resource.mutable) return fail(405, "read_only_resource", "This resource is read-only.");

  const context = await requireMember(request, {
    write: true,
    allowAgentWrite: ["content-items", "content-assets", "agent-work-items", "agent-work-dependencies", "content-feedback"].includes(resourceName),
  });
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
