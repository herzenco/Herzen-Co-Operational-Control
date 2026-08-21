import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchHerzencoEvents } from "./dispatcher";
import { HERZENCO_OCC_PROPERTY } from "./herzenco";

type Row = Record<string, any>;

const DEFAULT_REQUEST_ID = "herzenco-resource-publishing";
const ARTICLE_URL_BASE = "https://herzenco.co/resources";
const ARTICLE_SELECT = "id,title,brief,body,slug,seo_title,meta_description,status,approval_state,publication_state,review_approved_at,publish_at,published_at,final_url,posting_instructions,audit_status,seo_score,aeo_score,approval_id,monthly_ops_request_id,monthly_ops_version,audit_iteration_count,failure_message,metadata,package_manifest,property:content_properties!inner(slug),channel:content_channels!inner(platform),content_type:content_types(slug)";

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function relation(value: unknown) {
  return record(Array.isArray(value) ? value[0] : value);
}

function score(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function articleUrl(slug: unknown) {
  const value = text(slug);
  return value ? `${ARTICLE_URL_BASE}/${value}/` : "";
}

function websitePostingInstructions(slug: unknown) {
  return `Publish to ${articleUrl(slug)} at the approved publication time. The website pulls the canonical OCC record; send only the content identifier in the webhook.`;
}

export function validateHerzencoPublicationCandidate(row: Row, options: { requireApproval?: boolean } = {}) {
  const errors: string[] = [];
  const property = relation(row.property || row.content_properties);
  const channel = relation(row.channel || row.content_channels);
  const contentType = relation(row.content_type || row.content_types);
  const metadata = record(row.metadata);
  const role = text(metadata.content_role).toLowerCase();

  if (text(property.slug) !== HERZENCO_OCC_PROPERTY) errors.push("The content property must be Herzen Co.");
  if (text(channel.platform) !== "website") errors.push("The publishing channel must be the website.");
  if (role !== "blog" && !["blog", "website-article"].includes(text(contentType.slug))) {
    errors.push("The content must be a website article or blog post.");
  }
  if (!text(row.title)) errors.push("A title is required.");
  if (!text(row.body)) errors.push("Article body content is required.");
  if (!text(metadata.excerpt) && !text(row.brief)) errors.push("An excerpt or brief is required.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text(row.slug))) errors.push("A URL-safe slug is required.");
  if (!text(row.seo_title)) errors.push("An SEO title is required.");
  if (!text(row.meta_description)) errors.push("A meta description is required.");
  const publishAt = new Date(String(row.publish_at || ""));
  if (Number.isNaN(publishAt.valueOf())) errors.push("A valid publication date is required.");
  if (text(row.audit_status) !== "passed") errors.push("The independent content audit must pass.");
  if (score(row.seo_score) < 80) errors.push("The SEO score must be at least 80.");
  if (score(row.aeo_score) < 80) errors.push("The AEO score must be at least 80.");
  if (options.requireApproval !== false) {
    if (text(row.approval_state) !== "approved") errors.push("Human approval is required.");
    if (!text(row.review_approved_at)) errors.push("The approval timestamp is required.");
  }
  return errors;
}

async function recordTransition(supabase: SupabaseClient, item: Row, from: string, to: string, reason: string, nextAction: string | null) {
  const { error } = await supabase.from("monthly_content_transition_events").insert({
    request_id: text(item.monthly_ops_request_id) || DEFAULT_REQUEST_ID,
    content_item_id: item.id,
    from_status: from,
    to_status: to,
    actor_type: "system",
    actor_id: "herzenco-publishing-worker",
    reason,
    evidence: [{ publish_at: item.publish_at, final_url: articleUrl(item.slug) }],
    retry_count: Number(item.audit_iteration_count || 0),
    next_action: nextAction,
  });
  if (error) throw error;
}

async function syncApprovalRecord(supabase: SupabaseClient, item: Row, decidedAt: string) {
  if (!item.approval_id) return;
  const { error } = await supabase.from("approvals").update({
    status: "approved",
    decision_note: null,
    decided_at: decidedAt,
  }).eq("id", item.approval_id).eq("status", "pending");
  if (error) throw error;
}

async function flagInvalidCandidate(supabase: SupabaseClient, item: Row, errors: string[]) {
  const failure = `Website publication blocked: ${errors.join(" ")}`;
  const nextAction = "Correct the publishing requirements and return the item for human approval.";
  if (item.status === "recovery_required" && item.publication_state === "failed" && item.failure_message === failure) return;
  const fromStatus = text(item.status);
  const fromPublicationState = text(item.publication_state);
  const { data: blocked, error } = await supabase.from("content_items").update({
    status: "recovery_required",
    publication_state: "failed",
    failure_message: failure,
    blocker: failure,
    next_action: nextAction,
  }).eq("id", item.id).eq("status", fromStatus).eq("publication_state", fromPublicationState).eq("approval_state", "approved").select("id").maybeSingle();
  if (error) throw error;
  if (blocked && fromStatus !== "recovery_required") {
    await recordTransition(supabase, item, fromStatus, "recovery_required", failure, nextAction);
  }
}

export async function reconcileApprovedHerzencoArticles(supabase: SupabaseClient, now = new Date()) {
  const { data, error } = await supabase.from("content_items")
    .select(ARTICLE_SELECT)
    .eq("monthly_ops_version", 2)
    .eq("approval_state", "approved")
    .neq("publication_state", "published")
    .eq("property.slug", HERZENCO_OCC_PROPERTY)
    .eq("channel.platform", "website");
  if (error) throw error;

  const results: Array<Record<string, unknown>> = [];
  for (const item of (data || []) as Row[]) {
    if (["scheduled", "published"].includes(text(item.status))) continue;
    const errors = validateHerzencoPublicationCandidate(item);
    if (text(item.status) !== "approved") errors.unshift("The workflow must return to approved status before scheduling.");
    if (errors.length) {
      await flagInvalidCandidate(supabase, item, errors);
      results.push({ content_item_id: item.id, action: "blocked", errors });
      continue;
    }

    const nextAction = new Date(item.publish_at) <= now
      ? "Publish the approved website article now."
      : `Publish the approved website article at ${new Date(item.publish_at).toISOString()}.`;
    const updatedMetadata = { ...record(item.metadata), publishing_enabled: true };
    const updatedManifest = { ...record(item.package_manifest), publishing_enabled: true };
    const { data: scheduled, error: scheduleError } = await supabase.from("content_items").update({
      status: "scheduled",
      publication_state: "scheduled",
      final_url: articleUrl(item.slug),
      posting_instructions: text(item.posting_instructions) || websitePostingInstructions(item.slug),
      failure_message: null,
      blocker: null,
      next_action: nextAction,
      last_meaningful_activity_at: now.toISOString(),
      metadata: updatedMetadata,
      package_manifest: updatedManifest,
    }).eq("id", item.id).eq("status", "approved").eq("approval_state", "approved").select("id").maybeSingle();
    if (scheduleError) throw scheduleError;
    if (!scheduled) continue;
    await syncApprovalRecord(supabase, item, item.review_approved_at || now.toISOString());
    await recordTransition(supabase, item, "approved", "scheduled", "The approved Herzen Co. website article entered its publication schedule.", nextAction);
    results.push({ content_item_id: item.id, action: "scheduled", publish_at: new Date(item.publish_at).toISOString() });
  }
  return results;
}

export async function publishDueHerzencoArticles(supabase: SupabaseClient, now = new Date()) {
  const { data, error } = await supabase.from("content_items")
    .select(ARTICLE_SELECT)
    .eq("monthly_ops_version", 2)
    .eq("approval_state", "approved")
    .eq("status", "scheduled")
    .in("publication_state", ["scheduled", "failed", "blocked"])
    .lte("publish_at", now.toISOString())
    .eq("property.slug", HERZENCO_OCC_PROPERTY)
    .eq("channel.platform", "website");
  if (error) throw error;

  const results: Array<Record<string, unknown>> = [];
  for (const item of (data || []) as Row[]) {
    const errors = validateHerzencoPublicationCandidate(item);
    if (errors.length) {
      await flagInvalidCandidate(supabase, item, errors);
      results.push({ content_item_id: item.id, action: "blocked", errors });
      continue;
    }
    const previousPublicationState = text(item.publication_state);
    const publishedAt = now.toISOString();
    const { data: published, error: publishError } = await supabase.from("content_items").update({
      status: "published",
      publication_state: "published",
      published_at: publishedAt,
      final_url: articleUrl(item.slug),
      posting_instructions: text(item.posting_instructions) || websitePostingInstructions(item.slug),
      failure_message: null,
      blocker: null,
      next_action: "Track article performance.",
      last_meaningful_activity_at: publishedAt,
      metadata: { ...record(item.metadata), publishing_enabled: true },
      package_manifest: { ...record(item.package_manifest), publishing_enabled: true },
    }).eq("id", item.id).eq("status", "scheduled").eq("approval_state", "approved").eq("publication_state", previousPublicationState).select("id").maybeSingle();
    if (publishError) throw publishError;
    if (!published) continue;
    await recordTransition(supabase, item, "scheduled", "published", "The approved article reached its publication time and was released to the website.", "Track article performance.");
    results.push({ content_item_id: item.id, action: "published", published_at: publishedAt });
  }
  return results;
}

export async function runHerzencoPublishingCycle(supabase: SupabaseClient, now = new Date()) {
  const reconciled = await reconcileApprovedHerzencoArticles(supabase, now);
  const published = await publishDueHerzencoArticles(supabase, now);
  const website_events = await dispatchHerzencoEvents(supabase, now);
  return { reconciled, published, website_events };
}
