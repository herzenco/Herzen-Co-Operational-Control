import type { SupabaseClient } from "@supabase/supabase-js";
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
    .select("*")
    .eq("id", input.contentItemId)
    .single();
  if (itemError || !item) throw itemError || new Error("The content item was not found.");

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
