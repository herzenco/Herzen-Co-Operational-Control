import { isApiError, requireMember } from "../../../../../../utils/api/auth";
import { fail, ok, preflight, readJson } from "../../../../../../utils/api/responses";
import { buildLinkedInPublicationSnapshot, type LinkedInMedia, type LinkedInPublicationPayload } from "../../../../../../utils/content-automation/linkedin-publication";
import { disabledAutomationResult, shouldBlockHerzenCoContentOperation } from "../../../../../../utils/content-automation/retirement";
import { createAutomationClient } from "../../../../../../utils/content-automation/server";

type RouteContext = { params: Promise<{ id: string }> };
type DbRecord = Record<string, unknown>;

function isLupeOrHumanOperator(context: Awaited<ReturnType<typeof requireMember>>) {
  if (isApiError(context)) return false;
  if (context.member.role !== "agent") return true;
  return String(context.member.permissions.agent_code || "").toLowerCase() === "lupe";
}

async function loadSnapshot(contentItemId: string) {
  const supabase = createAutomationClient();
  const { data: item, error } = await supabase.from("content_items").select("*").eq("id", contentItemId).single();
  if (error || !item) return { error: fail(404, "not_found", "The content item was not found.") };
  const [propertyResult, channelResult, assetResult, feedbackResult] = await Promise.all([
    supabase.from("content_properties").select("id,name,slug,status").eq("id", item.property_id).single(),
    supabase.from("content_channels").select("id,property_id,platform,account_name,account_identifier,status").eq("id", item.channel_id).single(),
    supabase.from("content_assets").select("*").eq("content_item_id", item.id).eq("is_current", true).order("version", { ascending: false }),
    supabase.from("content_feedback").select("required,status").eq("content_item_id", item.id),
  ]);
  if (propertyResult.error || !propertyResult.data) return { error: fail(409, "property_missing", "The content item's property could not be resolved.") };
  if (shouldBlockHerzenCoContentOperation(String(propertyResult.data.slug || ""))) {
    const retirement = disabledAutomationResult("linkedin_publication");
    return { error: fail(409, retirement.code, retirement.message, retirement) };
  }
  if (channelResult.error || !channelResult.data) return { error: fail(409, "channel_missing", "The content item's channel could not be resolved.") };
  if (assetResult.error) return { error: fail(409, "assets_unavailable", assetResult.error.message) };
  if (feedbackResult.error) return { error: fail(409, "feedback_unavailable", feedbackResult.error.message) };
  const snapshot = buildLinkedInPublicationSnapshot({
    item,
    property: propertyResult.data,
    channel: channelResult.data,
    assets: assetResult.data || [],
    feedback: feedbackResult.data || [],
  });
  if (!snapshot.ok) return { error: fail(409, "linkedin_publication_blocked", "This item cannot be handed to Lupe for LinkedIn publishing.", { blockers: snapshot.errors }) };
  return { supabase, payload: snapshot.payload };
}

async function addSignedMediaUrls(payload: LinkedInPublicationPayload) {
  const supabase = createAutomationClient();
  const media = await Promise.all(payload.media.map(async (asset): Promise<LinkedInMedia> => {
    if (asset.url || !asset.storage_bucket || !asset.storage_path) return asset;
    const { data, error } = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 3600, { download: asset.file_name });
    if (error || !data?.signedUrl) return asset;
    return { ...asset, url: data.signedUrl };
  }));
  return { ...payload, media };
}

export async function GET(request: Request, { params }: RouteContext) {
  const context = await requireMember(request);
  if (isApiError(context)) return context;
  const { id } = await params;
  const snapshot = await loadSnapshot(id);
  if (snapshot.error) return snapshot.error;
  return ok({ publish_input: await addSignedMediaUrls(snapshot.payload), source_of_truth: "OCC", action: "preview_only" });
}

export async function POST(request: Request, { params }: RouteContext) {
  const context = await requireMember(request, { write: true, allowAgentWrite: true });
  if (isApiError(context)) return context;
  if (!isLupeOrHumanOperator(context)) return fail(403, "lupe_publish_required", "Only Lupe or a human OCC operator can claim LinkedIn publication work.");
  const { id } = await params;
  const snapshot = await loadSnapshot(id);
  if (snapshot.error) return snapshot.error;
  const payload = await addSignedMediaUrls(snapshot.payload);
  const { data, error } = await snapshot.supabase.rpc("claim_linkedin_publication", {
    p_content_item_id: id,
    p_approved_payload: payload,
    p_approved_content_hash: snapshot.payload.approved_content_hash,
    p_idempotency_key: snapshot.payload.idempotency_key,
  });
  if (error) return fail(409, "linkedin_claim_failed", error.message);
  const claim = (data || {}) as DbRecord;
  return ok({
    ...claim,
    should_publish: claim.state === "claimed",
    publish_input: claim.state === "claimed" ? payload : null,
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const context = await requireMember(request, { write: true, allowAgentWrite: true });
  if (isApiError(context)) return context;
  if (!isLupeOrHumanOperator(context)) return fail(403, "lupe_publish_required", "Only Lupe or a human OCC operator can reconcile LinkedIn publication work.");
  const { id } = await params;
  const body = await readJson(request);
  if (!body) return fail(400, "invalid_json", "Send a JSON request body.");
  const status = String(body.status || "");
  const idempotencyKey = String(body.idempotency_key || "").trim();
  if (!idempotencyKey) return fail(422, "idempotency_key_required", "Return the OCC idempotency key with the publication result.");
  const supabase = createAutomationClient();

  if (status === "published") {
    const finalUrl = String(body.final_url || "").trim();
    if (!finalUrl) return fail(422, "final_url_required", "A successful LinkedIn publication must return its final URL.");
    const { data, error } = await supabase.rpc("complete_linkedin_publication", {
      p_content_item_id: id,
      p_idempotency_key: idempotencyKey,
      p_final_url: finalUrl,
      p_external_id: String(body.external_id || "").trim() || null,
      p_provider_response: body.provider_response && typeof body.provider_response === "object" ? body.provider_response : {},
      p_published_at: body.published_at ? String(body.published_at) : null,
    });
    if (error) return fail(409, "linkedin_completion_failed", error.message);
    return ok(data);
  }

  if (status === "failed") {
    const message = String(body.error || body.failure_message || "").trim();
    if (!message) return fail(422, "failure_message_required", "Record a clear failure before retrying this LinkedIn publication.");
    const { data, error } = await supabase.rpc("fail_linkedin_publication", {
      p_content_item_id: id,
      p_idempotency_key: idempotencyKey,
      p_failure_message: message,
      p_provider_response: body.provider_response && typeof body.provider_response === "object" ? body.provider_response : {},
    });
    if (error) return fail(409, "linkedin_failure_record_failed", error.message);
    return ok(data);
  }

  return fail(422, "invalid_publication_status", "LinkedIn publication results must be 'published' or 'failed'.");
}

export const OPTIONS = preflight;
