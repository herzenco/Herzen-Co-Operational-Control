import type { SupabaseClient } from "@supabase/supabase-js";
import { validateHerzencoPublicationCandidate } from "../content-publishing/lifecycle";
import { buildWebsitePublicationSnapshot, type DbRecord } from "./website-publication";

export type ApprovalResult =
  | { ok: true; jobId: string; payload: DbRecord }
  | { ok: false; errors: string[] };

export async function approveWebsitePublication(supabase: SupabaseClient, input: {
  contentItemId: string;
  reviewLinkId?: string | null;
  reviewerName?: string | null;
  reviewerEmail?: string | null;
}): Promise<ApprovalResult> {
  const { data: item, error: itemError } = await supabase
    .from("content_items")
    .select("*,property:content_properties(slug),channel:content_channels(platform),content_type:content_types(slug)")
    .eq("id", input.contentItemId)
    .single();
  if (itemError || !item) throw itemError || new Error("The content item was not found.");

  // Monthly Content Operations uses the canonical pull + identifier-event
  // website workflow. Approval enables the scheduler but never creates a
  // legacy full-payload publication job.
  if (Number(item.monthly_ops_version || 0) === 2) {
    const approvedAt = new Date().toISOString();
    const reviewer = String(input.reviewerName || input.reviewerEmail || "Herzen reviewer").trim();
    if (["approved", "scheduled", "published"].includes(String(item.status)) && item.approval_state === "approved") {
      if (item.approval_id) {
        const { error } = await supabase.from("approvals").update({ status: "approved", decision_note: null, decided_at: item.review_approved_at || approvedAt })
          .eq("id", item.approval_id).eq("status", "pending");
        if (error) throw error;
      }
      return { ok: true, jobId: `canonical-scheduler:${item.id}`, payload: { publishing_enabled: true, approved_at: item.review_approved_at || approvedAt } };
    }
    if (item.status !== "ready_for_tito") {
      return { ok: false, errors: [`This content is no longer awaiting approval (current status: ${item.status || "unset"}).`] };
    }
    const readinessErrors = validateHerzencoPublicationCandidate({
      ...item,
      approval_state: "approved",
      review_approved_at: approvedAt,
    });
    if (readinessErrors.length) return { ok: false, errors: readinessErrors };

    const nextAction = item.publish_at && new Date(item.publish_at) <= new Date()
      ? "Publish the approved website article now."
      : `Schedule the approved website article for ${new Date(item.publish_at).toISOString()}.`;
    const { data: approved, error: approvalOnlyError } = await supabase.from("content_items").update({
      status: "approved",
      approval_state: "approved",
      review_approved_at: approvedAt,
      review_approved_by: reviewer,
      publication_state: "unpublished",
      failure_message: null,
      blocker: null,
      next_action: nextAction,
      last_meaningful_activity_at: approvedAt,
      metadata: { ...(item.metadata || {}), publishing_enabled: true },
      package_manifest: { ...(item.package_manifest || {}), publishing_enabled: true },
    }).eq("id", item.id).eq("status", "ready_for_tito").select("id").maybeSingle();
    if (approvalOnlyError) throw approvalOnlyError;
    if (!approved) return { ok: false, errors: ["The content changed while it was being approved. Refresh and review its current state."] };

    if (item.approval_id) {
      const { error } = await supabase.from("approvals").update({ status: "approved", decision_note: null, decided_at: approvedAt })
        .eq("id", item.approval_id).eq("status", "pending");
      if (error) throw error;
    }
    const { error: transitionError } = await supabase.from("monthly_content_transition_events").insert({
      request_id: item.monthly_ops_request_id || "herzenco-resource-publishing",
      content_item_id: item.id,
      from_status: "ready_for_tito",
      to_status: "approved",
      actor_type: "human",
      actor_id: reviewer,
      reason: "Tito approved the website article for scheduled publication.",
      evidence: [{ review_link_id: input.reviewLinkId || null, approved_at: approvedAt }],
      retry_count: Number(item.audit_iteration_count || 0),
      next_action: nextAction,
    });
    if (transitionError) throw transitionError;
    return { ok: true, jobId: `canonical-scheduler:${item.id}`, payload: { publishing_enabled: true, approved_at: approvedAt } };
  }

  const [channelResult, contentTypeResult, assetResult] = await Promise.all([
    supabase.from("content_channels").select("*").eq("id", item.channel_id).single(),
    item.content_type_id
      ? supabase.from("content_types").select("*").eq("id", item.content_type_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("content_assets").select("*").eq("content_item_id", item.id).eq("is_current", true).order("version", { ascending: false }),
  ]);
  if (channelResult.error || !channelResult.data) throw channelResult.error || new Error("The assigned publishing channel was not found.");
  if (contentTypeResult.error) throw contentTypeResult.error;
  if (assetResult.error) throw assetResult.error;

  const approvedAt = new Date().toISOString();
  const reviewer = String(input.reviewerName || input.reviewerEmail || "Herzen reviewer").trim();
  const snapshot = buildWebsitePublicationSnapshot({
    item,
    channel: channelResult.data,
    contentType: contentTypeResult.data,
    assets: assetResult.data || [],
    reviewer,
    approvedAt,
  });
  if (!snapshot.ok) return snapshot;

  const { data: jobId, error: approvalError } = await supabase.rpc("approve_content_publication", {
    p_content_item_id: item.id,
    p_review_link_id: input.reviewLinkId || null,
    p_reviewer_name: input.reviewerName || null,
    p_reviewer_email: input.reviewerEmail || null,
    p_approved_payload: snapshot.payload,
    p_approved_content_hash: snapshot.payload.approved_content_hash,
    p_idempotency_key: snapshot.payload.idempotency_key,
    p_destination: snapshot.payload.destination,
    p_scheduled_for: item.publish_at || null,
  });
  if (approvalError || !jobId) throw approvalError || new Error("The publication job was not created.");
  return { ok: true, jobId: String(jobId), payload: snapshot.payload };
}
