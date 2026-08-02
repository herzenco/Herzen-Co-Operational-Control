import { isApiError, requireMember } from "../../../../../../utils/api/auth";
import { fail, ok, preflight } from "../../../../../../utils/api/responses";
import { canonicalAssetLocation, deliverableBlockers } from "../../../../../../utils/social-operations";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const context = await requireMember(request);
  if (isApiError(context)) return context;

  const { data: item, error } = await context.supabase.from("content_items").select("*").eq("id", id).single();
  if (error || !item) return fail(404, "not_found", "The content package was not found.");

  const [propertyResult, channelResult, sourceResult, deliveryResult, feedbackResult] = await Promise.all([
    context.supabase.from("content_properties").select("id,name,slug").eq("id", item.property_id).single(),
    context.supabase.from("content_channels").select("id,platform,account_name,account_identifier").eq("id", item.channel_id).single(),
    item.source_asset_id ? context.supabase.from("content_assets").select("*").eq("id", item.source_asset_id).single() : Promise.resolve({ data: null, error: null }),
    item.delivery_asset_id ? context.supabase.from("content_assets").select("*").eq("id", item.delivery_asset_id).single() : Promise.resolve({ data: null, error: null }),
    context.supabase.from("content_feedback").select("id,required,status,version").eq("content_item_id", id),
  ]);
  const blockers = deliverableBlockers(item, feedbackResult.data || []);
  if (sourceResult.data?.content_item_id !== id) blockers.push("source_asset_mismatch");
  if (deliveryResult.data?.content_item_id !== id || deliveryResult.data?.asset_role !== "delivery" || !deliveryResult.data?.is_current) {
    blockers.push("delivery_asset_mismatch");
  }
  if (blockers.length) {
    return fail(409, "package_blocked", "This OCC package is not ready to deliver.", { blockers: [...new Set(blockers)] });
  }
  let deliveryUrl = String(deliveryResult.data.external_url || "");
  if (!deliveryUrl && deliveryResult.data.storage_bucket && deliveryResult.data.storage_path) {
    const signed = await context.supabase.storage
      .from(deliveryResult.data.storage_bucket)
      .createSignedUrl(deliveryResult.data.storage_path, 3600, { download: deliveryResult.data.file_name });
    if (signed.error || !signed.data?.signedUrl) return fail(409, "delivery_asset_unavailable", "The canonical delivery asset could not be retrieved from OCC storage.");
    deliveryUrl = signed.data.signedUrl;
  }

  return ok({
    package_id: item.id,
    title: item.title,
    brand: propertyResult.data,
    platform: channelResult.data,
    planned_publish_at: item.publish_at,
    final_caption: item.caption || item.body,
    hashtags: item.hashtags || [],
    posting_instructions: item.posting_instructions,
    tags: item.tags || [],
    cta: item.cta,
    approval_state: item.approval_state,
    feedback_version: item.feedback_version,
    source_asset: { ...sourceResult.data, canonical_location: canonicalAssetLocation(sourceResult.data || {}) },
    delivery_assets: [{ ...deliveryResult.data, canonical_location: canonicalAssetLocation(deliveryResult.data || {}), download_url: deliveryUrl }],
    generated_at: new Date().toISOString(),
    source_of_truth: "OCC",
  });
}

export const OPTIONS = preflight;
