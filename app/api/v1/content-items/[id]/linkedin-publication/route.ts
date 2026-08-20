import { isApiError, requireMember, type ApiContext } from "../../../../../../utils/api/auth";
import { fail, ok, preflight, readJson } from "../../../../../../utils/api/responses";
import { buildLinkedInPublicationSnapshot, type LinkedInMedia, type LinkedInPublicationPayload } from "../../../../../../utils/content-automation/linkedin-publication";
import { createAutomationClient } from "../../../../../../utils/content-automation/server";

type RouteContext = { params: Promise<{ id: string }> };
type DbRecord = Record<string, unknown>;

function isLupeOrHumanOperator(context: Awaited<ReturnType<typeof requireMember>>) {
  if (isApiError(context)) return false;
  if (context.member.role !== "agent") return true;
  return String(context.member.permissions.agent_code || "").toLowerCase() === "lupe";
}

function publicationActor(context: ApiContext) {
  if (context.member.role === "agent") {
    return `agent:${String(context.member.permissions.agent_code || context.agentId || "unknown").toLowerCase()}`;
  }
  return `member:${context.member.user_id}`;
}

async function loadSnapshot(contentItemId: string) {
  const supabase = createAutomationClient();
  const { data: item, error } = await supabase.from("content_items").select("*").eq("id", contentItemId).single();
  if (error || !item) return { error: fail(404, "not_found", "The content item was not found.") };
  const [propertyResult, channelResult, assetResult, feedbackResult, publicationResult] = await Promise.all([
    supabase.from("content_properties").select("id,name,slug,status").eq("id", item.property_id).single(),
    supabase.from("content_channels").select("id,property_id,platform,account_name,account_identifier,status").eq("id", item.channel_id).single(),
    supabase.from("content_assets").select("*").eq("content_item_id", item.id).eq("is_current", true).order("version", { ascending: false }),
    supabase.from("content_feedback").select("required,status").eq("content_item_id", item.id),
    supabase.from("content_publish_jobs").select("*").eq("content_item_id", item.id).eq("platform", "linkedin").maybeSingle(),
  ]);
  if (propertyResult.error || !propertyResult.data) return { error: fail(409, "property_missing", "The content item's property could not be resolved.") };
  if (channelResult.error || !channelResult.data) return { error: fail(409, "channel_missing", "The content item's channel could not be resolved.") };
  if (assetResult.error) return { error: fail(409, "assets_unavailable", assetResult.error.message) };
  if (feedbackResult.error) return { error: fail(409, "feedback_unavailable", feedbackResult.error.message) };
  if (publicationResult.error) return { error: fail(409, "linkedin_publication_state_unavailable", publicationResult.error.message) };
  const snapshot = buildLinkedInPublicationSnapshot({
    item,
    property: propertyResult.data,
    channel: channelResult.data,
    assets: assetResult.data || [],
    feedback: feedbackResult.data || [],
  });
  if (snapshot.ok === false) return { error: fail(409, "linkedin_publication_blocked", "This item cannot be handed to Lupe for LinkedIn publishing.", { blockers: snapshot.errors }) };
  return { supabase, payload: snapshot.payload, publication: publicationResult.data || null };
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
  return ok({
    publish_input: await addSignedMediaUrls(snapshot.payload),
    publication: snapshot.publication,
    source_of_truth: "OCC",
    action: "read_only",
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  const context = await requireMember(request, { write: true, allowAgentWrite: true });
  if (isApiError(context)) return context;
  if (!isLupeOrHumanOperator(context)) return fail(403, "lupe_publish_required", "Only Lupe or a human OCC operator can claim LinkedIn publication work.");
  const { id } = await params;
  const actor = publicationActor(context);
  const snapshot = await loadSnapshot(id);
  if (snapshot.error) return snapshot.error;
  const payload = await addSignedMediaUrls(snapshot.payload);
  const { data, error } = await snapshot.supabase.rpc("claim_linkedin_publication", {
    p_content_item_id: id,
    p_approved_payload: payload,
    p_approved_content_hash: snapshot.payload.approved_content_hash,
    p_idempotency_key: snapshot.payload.idempotency_key,
    p_claim_owner: actor,
    p_claim_ttl_seconds: 900,
  });
  if (error) return fail(409, "linkedin_claim_failed", error.message);
  const claim = (data || {}) as DbRecord;
  if (claim.state === "conflict") {
    return fail(409, "linkedin_claim_conflict", "Another owner holds the active LinkedIn publication claim.", claim);
  }
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
  const actor = publicationActor(context);
  const body = await readJson(request);
  if (!body) return fail(400, "invalid_json", "Send a JSON request body.");
  const status = String(body.status || "");
  const idempotencyKey = String(body.idempotency_key || "").trim();
  const supabase = createAutomationClient();

  if (status === "published") {
    if (!idempotencyKey) return fail(422, "idempotency_key_required", "Return the OCC idempotency key with the publication result.");
    const postedUrl = String(body.posted_url || body.final_url || "").trim();
    const publishingActor = String(body.publishing_actor || "").trim();
    if (!postedUrl) return fail(422, "posted_url_required", "A successful LinkedIn publication must return its verified posted URL.");
    if (!publishingActor) return fail(422, "publishing_actor_required", "Identify Lupe or the sanctioned automation that published the post.");
    const { data, error } = await supabase.rpc("complete_linkedin_publication", {
      p_content_item_id: id,
      p_idempotency_key: idempotencyKey,
      p_final_url: postedUrl,
      p_external_id: String(body.external_id || "").trim() || null,
      p_publishing_actor: publishingActor,
      p_recorded_by: actor,
      p_provider_response: body.provider_response && typeof body.provider_response === "object" ? body.provider_response : {},
      p_published_at: body.posted_at || body.published_at ? String(body.posted_at || body.published_at) : null,
    });
    if (error) return fail(409, "linkedin_completion_failed", error.message);
    return ok(data);
  }

  if (status === "failed" || status === "blocked") {
    const message = String(body.error || body.failure_message || "").trim();
    const failedStep = String(body.failed_step || body.failure_step || "").trim();
    if (!message) return fail(422, "failure_message_required", "Record a clear failure before retrying this LinkedIn publication.");
    if (!failedStep) return fail(422, "failure_step_required", "Identify the step that failed or became blocked.");
    const { data, error } = await supabase.rpc("fail_linkedin_publication", {
      p_content_item_id: id,
      p_idempotency_key: idempotencyKey || `occ:linkedin:${id}`,
      p_failure_status: status,
      p_failure_step: failedStep,
      p_failure_message: message,
      p_recorded_by: actor,
      p_provider_response: body.provider_response && typeof body.provider_response === "object" ? body.provider_response : {},
      p_failed_at: body.failed_at ? String(body.failed_at) : null,
    });
    if (error) return fail(409, "linkedin_failure_record_failed", error.message);
    return ok(data);
  }

  return fail(422, "invalid_publication_status", "LinkedIn publication results must be 'published', 'failed', or 'blocked'.");
}

export const OPTIONS = preflight;
