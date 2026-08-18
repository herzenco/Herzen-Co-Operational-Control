import { isApiError, requireMember } from "../../../../../utils/api/auth";
import { getResource, pickFields } from "../../../../../utils/api/resources";
import { fail, ok, preflight, readJson } from "../../../../../utils/api/responses";
import { serializeApiResource } from "../../../../../utils/content-assets";
import { approveWebsitePublication } from "../../../../../utils/content-automation/approve-publication";
import { createAutomationClient } from "../../../../../utils/content-automation/server";
import { normalizeContentWrite } from "../../../../../utils/content-write";

type RouteContext = { params: Promise<{ resource: string; id: string }> };

const machineWritableResources = new Set([
  "tasks",
  "content-items",
  "content-assets",
  "agent-work-items",
  "agent-work-dependencies",
  "content-feedback",
]);

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
    allowAgentWrite: machineWritableResources.has(resourceName),
  });
  if (isApiError(context)) return context;
  const body = await readJson(request);
  if (!body) return fail(400, "invalid_json", "Send a JSON request body.");

  let payload = pickFields(body, resource.updateFields);
  if (resourceName === "content-items") {
    const { data: current, error: currentError } = await context.supabase
      .from(resource.table)
      .select("caption,creative_asset_path,metadata,status,approval_state,channel_id")
      .eq("id", id)
      .single();
    if (currentError || !current) return fail(404, "not_found", "The requested record was not found.");
    const normalized = normalizeContentWrite({ ...current, ...payload });
    if (normalized.error) return fail(422, "unhosted_creative", normalized.error);
    payload = { ...payload, caption: normalized.payload.caption };
    if (current.status === "approved" && current.approval_state === "approved" && body.publish_at && body.status !== "publishing") {
      payload.status = "scheduled";
    }
    if (body.status === "publishing") {
      const { data: channel, error: channelError } = await context.supabase
        .from("content_channels")
        .select("platform")
        .eq("id", current.channel_id)
        .single();
      if (channelError || !channel) return fail(409, "channel_missing", "The content item's publishing channel could not be resolved.");
      if (channel.platform === "linkedin") return fail(409, "lupe_publish_required", "LinkedIn items are published only when Lupe claims the approved OCC item.");
    }
  }
  if (resourceName === "tasks" && body.status === "done" && !body.completed_at) {
    payload.completed_at = new Date().toISOString();
  }
  if (resourceName === "approvals" && body.status && body.status !== "pending") {
    if (["changes_requested", "declined"].includes(String(body.status)) && !String(body.decision_note || "").trim()) {
      return fail(422, "rejection_reason_required", "A written rejection reason is required for Lupe and the content owner.");
    }
    if (!context.user) return fail(403, "human_approval_required", "Only a signed-in human operator can decide approvals.");
    payload.decided_by = context.user.id;
    payload.decided_at = new Date().toISOString();
  }
  if (resourceName === "content-feedback" && body.status === "applied") {
    payload.applied_at = body.applied_at || new Date().toISOString();
  }

  if (resourceName === "approvals" && body.status === "approved") {
    const { data: currentApproval, error: currentApprovalError } = await context.supabase
      .from("approvals")
      .select("id,content_item_id")
      .eq("id", id)
      .single();
    if (currentApprovalError || !currentApproval) return fail(404, "not_found", "The approval record was not found.");
    if (currentApproval.content_item_id) {
      const { data: approvalItem, error: approvalItemError } = await context.supabase
        .from("content_items")
        .select("channel_id")
        .eq("id", currentApproval.content_item_id)
        .single();
      if (approvalItemError || !approvalItem) return fail(409, "approval_sync_failed", approvalItemError?.message || "The approval content item was not found.");
      const { data: approvalChannel, error: approvalChannelError } = approvalItem
        ? await context.supabase.from("content_channels").select("platform").eq("id", approvalItem.channel_id).single()
        : { data: null, error: null };
      if (approvalChannelError || !approvalChannel) return fail(409, "approval_sync_failed", approvalChannelError?.message || "The approval publishing channel was not found.");
      if (approvalChannel?.platform === "website") {
        const approval = await approveWebsitePublication(createAutomationClient(), {
          contentItemId: String(currentApproval.content_item_id),
          reviewerName: context.user?.email || "Herzen reviewer",
          reviewerEmail: context.user?.email || null,
        });
        if (!approval.ok) return fail(422, "website_destination_required", approval.errors.join(" "), { validation_errors: approval.errors });
        const { data: updatedApproval, error: updatedApprovalError } = await context.supabase.from("approvals").select("*").eq("id", id).single();
        if (updatedApprovalError || !updatedApproval) return fail(409, "approval_sync_failed", updatedApprovalError?.message || "The approval was recorded but could not be reloaded.");
        return ok(serializeApiResource(resourceName, updatedApproval));
      }
    }
  }

  const { data, error } = await context.supabase
    .from(resource.table)
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error || !data) return fail(400, "write_failed", error?.message || "The record could not be updated.");

  if (resourceName === "content-items" && ["cancelled", "rejected", "archived", "superseded"].includes(String(data.status))) {
    const { error: approvalWithdrawalError } = await context.supabase
      .from("approvals")
      .update({
        status: "withdrawn",
        decision_note: `Automatically withdrawn because the linked content item is ${String(data.status)}.`,
        decided_at: new Date().toISOString(),
      })
      .eq("content_item_id", data.id)
      .eq("status", "pending");
    if (approvalWithdrawalError) return fail(409, "approval_sync_failed", approvalWithdrawalError.message);
  }

  if (resourceName === "content-items" && data.approval_state === "approved") {
    if (body.status === "publishing") {
      const { error: queueError } = await createAutomationClient().from("content_publish_jobs").update({ status: "queued", scheduled_for: new Date().toISOString(), next_attempt_at: null, retryable: true }).eq("content_item_id", data.id).eq("platform", "website");
      if (queueError) return fail(409, "publication_queue_failed", queueError.message);
    } else if (body.publish_at && data.publish_at) {
      const { error: queueError } = await createAutomationClient().from("content_publish_jobs").update({ status: "queued", scheduled_for: data.publish_at, next_attempt_at: null, retryable: true }).eq("content_item_id", data.id).eq("platform", "website");
      if (queueError) return fail(409, "publication_queue_failed", queueError.message);
    }
  }

  if (resourceName === "approvals" && data.content_item_id && body.status && body.status !== "pending") {
    const { data: canonicalContent } = await context.supabase
      .from("content_items")
      .select("caption,body,source_asset_id,delivery_asset_id")
      .eq("id", data.content_item_id)
      .single();
    const contentUpdate =
      body.status === "approved"
        ? {
            status: "approved",
            approval_state: "approved",
            approved_by: context.user!.id,
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
              status: "revision_required",
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

  if (context.agentId) {
    await context.supabase.from("activity_log").insert({
      actor_user_id: null,
      action: "agent_update",
      entity_type: resource.table,
      entity_id: String(data.id),
      after_data: { agent_id: context.agentId, credential_id: context.credentialId },
    });
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
    allowAgentWrite: machineWritableResources.has(resourceName),
  });
  if (isApiError(context)) return context;
  const { data, error } = await context.supabase
    .from(resource.table)
    .delete()
    .eq("id", id)
    .select()
    .single();
  if (error || !data) return fail(409, "delete_failed", error?.message || "The record could not be deleted.");
  if (context.agentId) {
    await context.supabase.from("activity_log").insert({
      actor_user_id: null,
      action: "agent_delete",
      entity_type: resource.table,
      entity_id: String(data.id),
      after_data: { agent_id: context.agentId, credential_id: context.credentialId },
    });
  }
  return ok({ deleted: data });
}

export const OPTIONS = preflight;
