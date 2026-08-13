import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuditor } from "./auditors";
import { sendLupeDelivery, titlesAndLinksOnly } from "./delivery";
import { generatePair, planMonthlySlate, promoteEvergreenFallback } from "./generation";
import { loadLearningContext } from "./learning-context";
import { AnthropicJsonModel, OpenAIJsonModel } from "./models";
import { createReviewLink } from "./review-links";
import { contentItemUrl } from "../content-item-url";
import { disabledAutomationResult, isLegacyContentAutomationJobType, LegacyContentAutomationDisabledError } from "./retirement";
import { buildCanonicalPackage, readyQaChecklist } from "./packages";
import { etDayStart, nextMonthStart } from "./schedule";
import type { AutomationJobType, GeneratedAsset, PlannedTopic } from "./types";
import { PublicationProviderError, publishContent } from "./publishing";
import { executeMonthlyContentItem, runMonthlyContentWatchdog } from "../monthly-content/executor";

type DbRecord = Record<string, unknown>;

export function automationErrorMessage(failure: unknown, fallback = "Automation failed.") {
  if (failure instanceof Error) return failure.message;
  if (failure && typeof failure === "object" && "message" in failure) {
    const message = String((failure as { message?: unknown }).message || "").trim();
    if (message) return message;
  }
  return fallback;
}

async function log(supabase: SupabaseClient, runId: string, event: string, message: string, context: DbRecord = {}, level = "info") {
  await supabase.from("workflow_run_logs").insert({ run_id: runId, level, event, message, context });
}

async function deliverWithLease(supabase: SupabaseClient, input: {
  runId: string; type: "weekly_review_pack" | "publish_day_notice" | "lupe_check_in";
  items: Array<{ title: string; review_url: string }>; mode?: "final_checkpoint" | "heads_up"; key: string;
  testLabel?: "OCC TEST — DO NOT POST";
}) {
  const payload = { ...titlesAndLinksOnly(input.items), ...(input.mode ? { mode: input.mode } : {}), ...(input.testLabel ? { test_label: input.testLabel } : {}) };
  const { data: insertedJob, error: jobError } = await supabase.from("content_delivery_jobs").upsert({
    delivery_type: input.type, scheduled_for: new Date().toISOString(), payload, status: "queued",
    run_id: input.runId, idempotency_key: input.key,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id").maybeSingle();
  if (jobError) throw jobError;
  let job = insertedJob;
  if (!job) {
    const { data: existingJob, error: existingJobError } = await supabase.from("content_delivery_jobs")
      .select("id,status,next_attempt_at").eq("idempotency_key", input.key).maybeSingle();
    if (existingJobError) throw existingJobError;
    job = existingJob;
  }
  if (!job) throw new Error("The idempotent delivery job could not be loaded.");
  const { data: claims, error: claimError } = await supabase.rpc("claim_content_delivery_job", { p_job_id: job.id, p_lease_seconds: 120 });
  if (claimError) throw claimError;
  const claim = Array.isArray(claims) ? claims[0] : claims;
  if (!claim) return { status: "skipped_duplicate" };
  let providerConfirmed = false;
  try {
    const delivery = await sendLupeDelivery(input.type, input.items, input.mode, input.testLabel);
    const provider = (delivery.provider || {}) as DbRecord;
    const providerMessageId = String(provider.id || "");
    providerConfirmed = true;
    const { data: completed, error: completionError } = await supabase.rpc("complete_content_delivery_job", {
      p_job_id: job.id, p_lease_token: claim.lease_token, p_confirmed: true,
      p_provider_message_id: providerMessageId, p_provider_response: provider, p_error: null,
    });
    if (completionError || completed !== true) throw completionError || new Error("Delivery lease was lost before confirmation.");
    return { status: "sent", provider_message_id: providerMessageId };
  } catch (failure) {
    // If the provider accepted the message but persistence failed, preserve the
    // lease for quarantine/reconciliation; retrying could duplicate WhatsApp.
    if (providerConfirmed) throw failure;
    const message = automationErrorMessage(failure, "Delivery failed.");
    await supabase.rpc("complete_content_delivery_job", {
      p_job_id: job.id, p_lease_token: claim.lease_token, p_confirmed: false,
      p_provider_message_id: null, p_provider_response: {}, p_error: message,
    });
    throw failure;
  }
}

export async function deliverWhatsAppCanary(supabase: SupabaseClient, input: {
  runId: string;
  item: { title: string; review_url: string };
  idempotencyKey: string;
  testLabel: "OCC TEST — DO NOT POST";
}) {
  if (input.testLabel !== "OCC TEST — DO NOT POST") throw new Error("The exact WhatsApp canary label is required.");
  return deliverWithLease(supabase, {
    runId: input.runId,
    type: "lupe_check_in",
    items: [input.item],
    key: input.idempotencyKey,
    testLabel: input.testLabel,
  });
}

async function requireSingle(query: PromiseLike<{ data: DbRecord | null; error: { message: string } | null }>, label: string) {
  const { data, error } = await query;
  if (error || !data) throw new Error(error?.message || `${label} was not found.`);
  return data;
}

async function createContentRecord(supabase: SupabaseClient, input: {
  propertyId: string; channelId: string; contentTypeId?: string; generationRunId: string; topic: PlannedTopic; asset: GeneratedAsset; platform: "website" | "linkedin"; websiteUrl?: string;
}) {
  const { data, error } = await supabase.from("content_items").insert({
    title: input.asset.title,
    brief: input.topic.rationale,
    body: input.asset.body,
    caption: input.asset.caption || (input.platform === "linkedin" ? input.asset.body : null),
    property_id: input.propertyId,
    channel_id: input.channelId,
    content_type_id: input.contentTypeId || null,
    distribution_mode: "organic",
    status: "drafting",
    approval_required: true,
    publish_at: input.topic.publish_at,
    generation_run_id: input.generationRunId,
    target_audience: input.topic.target_audience,
    conversion_goal: input.topic.conversion_goal,
    slug: input.asset.slug,
    seo_title: input.asset.seo_title,
    meta_description: input.asset.meta_description,
    reasoning_summary: input.asset.reasoning_summary,
    source_links: input.topic.source_links,
    audit_status: "pending",
    metadata: { automation_phase: 1, content_role: input.platform === "website" ? "blog" : "linkedin_companion", website_url: input.websiteUrl || null, planned_website_url: input.websiteUrl || null, cta: input.topic.cta },
  }).select("*").single();
  if (error || !data) throw new Error(error?.message || `Could not create ${input.platform} content.`);
  return data as DbRecord;
}

async function auditUntilGate(supabase: SupabaseClient, runId: string, item: DbRecord, asset: GeneratedAsset, topic: PlannedTopic, context: DbRecord, maxIterations = 10) {
  const writer = new OpenAIJsonModel();
  const auditor = createAuditor(new AnthropicJsonModel());
  let currentAsset = asset;
  const contentRole = String((item.metadata as DbRecord)?.content_role || "");
  const auditContext = { ...context, intended_platform: contentRole === "linkedin_companion" ? "linkedin" : "website_blog" };
  let iteration = Number(item.audit_iteration_count || 0);
  while (iteration < maxIterations) {
    iteration += 1;
    await supabase.from("content_items").update({ audit_status: "running", audit_iteration_count: iteration }).eq("id", item.id);
    const result = await auditor.audit(currentAsset, auditContext);
    const { error: auditError } = await supabase.from("content_audits").insert({ content_item_id: item.id, iteration, provider: result.provider, seo_score: result.seo_score, aeo_score: result.aeo_score, summary: result.summary, blockers: result.blockers, rewrite_guidance: result.rewrite_guidance, raw_response: result.raw_response || {} });
    if (auditError) throw auditError;
    if (result.passed) {
      // Retain the active review-link record required by the package gate, but
      // expose the stable authenticated content-item route to people.
      await createReviewLink(supabase, String(item.id));
      const reviewUrl = contentItemUrl(String(item.id));
      const { data: packagedItem, error: packageReadError } = await supabase.from("content_items").select("package_manifest,source_asset_id,delivery_asset_id").eq("id", item.id).single();
      if (packageReadError || !packagedItem) throw packageReadError || new Error("Canonical package manifest was not found.");
      const packageManifest = {
        ...((packagedItem.package_manifest as DbRecord) || {}),
        caption: currentAsset.caption || currentAsset.body,
        source_asset_id: packagedItem.source_asset_id,
        delivery_asset_id: packagedItem.delivery_asset_id,
      };
      const canonicalSnapshot = { ...currentAsset, source_links: topic.source_links };
      const { error: assetSnapshotError } = await supabase.from("content_assets").update({ metadata: { canonical_snapshot: canonicalSnapshot, immutable: true, audit_iteration: iteration } }).eq("content_item_id", item.id).in("asset_role", ["source", "delivery"]).eq("is_current", true);
      if (assetSnapshotError) throw assetSnapshotError;
      const { error } = await supabase.from("content_items").update({ ...currentAsset, package_manifest: packageManifest, status: "ready_for_lupe", audit_status: "passed", audit_iteration_count: iteration, seo_score: result.seo_score, aeo_score: result.aeo_score, audit_summary: result.summary, audit_blockers: result.blockers, review_ready_at: new Date().toISOString(), review_url: reviewUrl, qa_checklist: readyQaChecklist() }).eq("id", item.id);
      if (error) throw error;
      await log(supabase, runId, "audit_passed", `${item.title} passed SEO and AEO gates.`, { content_item_id: item.id, iteration, seo_score: result.seo_score, aeo_score: result.aeo_score, provider: result.provider });
      return { passed: true, iteration, review_url: reviewUrl };
    }
    await log(supabase, runId, "audit_failed", `${item.title} failed audit iteration ${iteration}.`, { content_item_id: item.id, seo_score: result.seo_score, aeo_score: result.aeo_score, blockers: result.blockers }, "warn");
    if (iteration % 5 === 0) {
      const payload = titlesAndLinksOnly([{ title: String(item.title), review_url: contentItemUrl(String(item.id)) }]);
      await deliverWithLease(supabase, { runId, type: "lupe_check_in", items: payload.items, key: `audit-check-in:${item.id}:${iteration}` });
      await supabase.from("content_items").update({ audit_status: "check_in_required", audit_iteration_count: iteration, seo_score: result.seo_score, aeo_score: result.aeo_score, audit_summary: result.summary, audit_blockers: result.blockers }).eq("id", item.id);
      return { passed: false, iteration, check_in_required: true };
    }
    const rewrite = await generatePair(writer, topic, context, result.rewrite_guidance);
    const priorAsset = currentAsset;
    currentAsset = String((item.metadata as DbRecord)?.content_role) === "blog" ? rewrite.blog : rewrite.linkedin;
    const { error: rewriteError } = await supabase.from("content_rewrite_iterations").insert({ content_item_id: item.id, iteration, prior_asset: priorAsset, rewritten_asset: currentAsset, audit_result: result, rewrite_guidance: result.rewrite_guidance });
    if (rewriteError) throw rewriteError;
    await supabase.from("content_items").update({ title: currentAsset.title, body: currentAsset.body, caption: currentAsset.caption, slug: currentAsset.slug, seo_title: currentAsset.seo_title, meta_description: currentAsset.meta_description, reasoning_summary: currentAsset.reasoning_summary, audit_status: "failed", seo_score: result.seo_score, aeo_score: result.aeo_score, audit_summary: result.summary, audit_blockers: result.blockers }).eq("id", item.id);
  }
  return { passed: false, iteration };
}

async function runMonthlyGeneration(supabase: SupabaseClient, runId: string, now: Date, configuration: DbRecord) {
  const property = await requireSingle(supabase.from("content_properties").select("id,name,slug").eq("slug", String(configuration.property_slug || "herzen-co")).single(), "Herzen Co. property");
  const { data: channels, error: channelError } = await supabase.from("content_channels").select("id,platform").eq("property_id", property.id).in("platform", ["website","linkedin"]).eq("status", "active");
  if (channelError) throw channelError;
  const websiteChannel = channels?.find((channel) => channel.platform === "website");
  const linkedinChannel = channels?.find((channel) => channel.platform === "linkedin");
  if (!websiteChannel || !linkedinChannel) throw new Error("Herzen Co. requires active website and LinkedIn channels.");
  const context = await loadLearningContext(supabase, String(property.id));
  const monthStart = nextMonthStart(now);
  const { data: generationRun, error: generationError } = await supabase.from("content_generation_runs").upsert({ property_id: property.id, month_start: monthStart, status: "planning", context_snapshot: context, started_at: new Date().toISOString() }, { onConflict: "property_id,month_start" }).select("*").single();
  if (generationError || !generationRun) throw generationError || new Error("Could not create the generation run.");
  const writer = new OpenAIJsonModel();
  const slate = await planMonthlySlate(writer, context, monthStart);
  const pairLimit = Math.max(1, Number(configuration.pair_limit || 1));
  let selectedTopics = slate.topics.filter((topic) => topic.timely).slice(0, pairLimit);
  if (!selectedTopics.length && configuration.allow_evergreen_fallback === true) {
    const completeEvergreenTopic = slate.topics.find((topic) => !topic.timely);
    if (completeEvergreenTopic) selectedTopics = [completeEvergreenTopic];
    else if (slate.evergreen_fallbacks?.[0]) selectedTopics = [await promoteEvergreenFallback(writer, slate.evergreen_fallbacks[0], context, monthStart)];
  }
  await supabase.from("content_generation_runs").update({ status: "generating", planned_topics: slate }).eq("id", generationRun.id);
  const results = [];
  for (const topic of selectedTopics) {
    const pair = await generatePair(writer, topic, context);
    const websiteUrl = `${process.env.HERZEN_WEBSITE_URL || "https://herzen.co"}/${pair.blog.slug}`;
    const blog = await createContentRecord(supabase, { propertyId: String(property.id), channelId: String(websiteChannel.id), generationRunId: String(generationRun.id), topic, asset: pair.blog, platform: "website" });
    const linkedin = await createContentRecord(supabase, { propertyId: String(property.id), channelId: String(linkedinChannel.id), generationRunId: String(generationRun.id), topic, asset: pair.linkedin, platform: "linkedin", websiteUrl });
    await supabase.from("content_pairs").insert({ generation_run_id: generationRun.id, blog_content_item_id: blog.id, linkedin_content_item_id: linkedin.id, topic_key: topic.topic_key });
    await supabase.from("content_items").update({ paired_content_item_id: linkedin.id }).eq("id", blog.id);
    await supabase.from("content_items").update({ paired_content_item_id: blog.id }).eq("id", linkedin.id);
    await buildCanonicalPackage(supabase, blog, topic, pair.blog, "website");
    await buildCanonicalPackage(supabase, linkedin, topic, pair.linkedin, "linkedin");
    const generationOnlyCanary = configuration.generation_only_canary === true;
    const blogAudit = generationOnlyCanary ? { passed: false, generation_only: true } : await auditUntilGate(supabase, runId, blog, pair.blog, topic, context);
    const linkedinAudit = generationOnlyCanary ? { passed: false, generation_only: true } : await auditUntilGate(supabase, runId, linkedin, pair.linkedin, topic, context);
    results.push({ topic: topic.title, blog: { id: blog.id, ...blogAudit }, linkedin: { id: linkedin.id, ...linkedinAudit } });
  }
  const generationOnlyCanary = configuration.generation_only_canary === true;
  const allPassed = results.every((result) => result.blog.passed && result.linkedin.passed);
  await supabase.from("content_generation_runs").update({ status: generationOnlyCanary ? "partial" : allPassed ? "ready" : "partial", completed_at: new Date().toISOString() }).eq("id", generationRun.id);
  await log(supabase, runId, "monthly_generation_complete", `Generated ${results.length} linked content pairs.`, { evergreen_fallbacks: slate.evergreen_fallbacks, results });
  return { generation_run_id: generationRun.id, results, evergreen_fallbacks: slate.evergreen_fallbacks };
}

async function reviewDelivery(supabase: SupabaseClient, runId: string, type: "weekly_review_pack" | "publish_day_notice", now: Date, configuration: DbRecord) {
  const property = await requireSingle(supabase.from("content_properties").select("id").eq("slug", String(configuration.property_slug || "herzen-co")).single(), "Herzen Co. property");
  const start = etDayStart(now);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (type === "weekly_review_pack" ? 7 : 1));
  const { data, error } = await supabase.from("content_items").select("id,title,review_url,status,publish_at").eq("property_id", property.id).gte("publish_at", start.toISOString()).lt("publish_at", end.toISOString()).not("review_url", "is", null).order("publish_at");
  if (error) throw error;
  const items = (data || []).map((item) => ({ title: item.title, review_url: item.review_url }));
  const unapproved = (data || []).some((item) => !["approved","scheduled","publishing","published"].includes(item.status));
  const mode = type === "publish_day_notice" ? (unapproved ? "final_checkpoint" : "heads_up") : undefined;
  const delivery = await deliverWithLease(supabase, { runId, type, items, mode, key: `${type}:${start.toISOString()}` });
  return { count: items.length, mode, delivery };
}

async function runK2Refresh(supabase: SupabaseClient, configuration: DbRecord) {
  const property = await requireSingle(supabase.from("content_properties").select("id,slug").eq("slug", String(configuration.property_slug || "herzen-co")).single(), "Herzen Co. property");
  const context = await loadLearningContext(supabase, String(property.id));
  const { data: runs, error } = await supabase.from("content_generation_runs").update({ context_snapshot: context }).eq("property_id", property.id).in("status", ["planning","generating","auditing","partial"]).select("id");
  if (error) throw error;
  return { refreshed_at: new Date().toISOString(), generation_runs_updated: runs?.length || 0, context_counts: { prior_assets: context.prior_assets.length, review_history: context.review_history.length, audit_history: context.audit_history.length } };
}

async function runAuditRetry(supabase: SupabaseClient, runId: string, configuration: DbRecord = {}) {
  const property = await requireSingle(supabase.from("content_properties").select("id").eq("slug", "herzen-co").single(), "Herzen Co. property");
  const contentItemIds = Array.isArray(configuration.content_item_ids) ? configuration.content_item_ids.map(String) : [];
  const iterationLimit = contentItemIds.length && configuration.continue_after_check_in === true ? 15 : 5;
  let retryQuery = supabase.from("content_items").select("*").eq("property_id", property.id).contains("metadata", { automation_phase: 1 }).in("audit_status", ["pending","failed"]).lt("audit_iteration_count", iterationLimit);
  if (contentItemIds.length) retryQuery = retryQuery.in("id", contentItemIds);
  const { data, error } = await retryQuery.limit(Math.min(10, Math.max(1, Number(configuration.batch_size || 10))));
  if (error) throw error;
  const results = [];
  for (const item of data || []) {
    const topic = { topic_key: item.slug || item.id, title: item.title, rationale: item.brief || "", timely: true, target_audience: item.target_audience || "Herzen Co. audience", conversion_goal: item.conversion_goal || "Website visit", cta: String((item.metadata as DbRecord)?.cta || "Visit the website"), publish_at: item.publish_at, source_links: item.source_links || [] } as PlannedTopic;
    const asset = { title: item.title, body: item.body, caption: item.caption, slug: item.slug, seo_title: item.seo_title, meta_description: item.meta_description, reasoning_summary: item.reasoning_summary } as GeneratedAsset;
    results.push(await auditUntilGate(supabase, runId, item, asset, topic, {}, iterationLimit));
  }
  return { retried: results.length, results };
}

export async function runPublishQueue(supabase: SupabaseClient, publishNow = new Date()) {
  const stalePublishingAt = new Date(publishNow.getTime() - 15 * 60_000).toISOString();
  await supabase.from("content_publish_jobs").update({ status: "failed", retryable: true, next_attempt_at: publishNow.toISOString(), failure_message: "Recovered a stale publishing lease." }).eq("platform", "website").eq("status", "publishing").or(`last_request_at.is.null,last_request_at.lt.${stalePublishingAt}`);
  const { data: publishJobs, error: publishError } = await supabase.from("content_publish_jobs").select("*,content_items(*)").eq("platform", "website").or(`status.eq.queued,and(status.eq.failed,retryable.eq.true,next_attempt_at.lte.${publishNow.toISOString()})`).lte("scheduled_for", publishNow.toISOString()).order("scheduled_for").limit(10);
  if (publishError) throw publishError;
  const published = [];
  for (const job of publishJobs || []) {
    const item = job.content_items as DbRecord;
    const attempt = Number(job.attempt || 0) + 1;
    let attemptId: string | null = null;
    try {
      if (!item || item.approval_state !== "approved") throw new PublicationProviderError("The content item is not approved for publication.", { validationErrors: ["Approve the current final package before publishing."], retryable: false });
      const requestedAt = new Date().toISOString();
      await supabase.from("content_publish_jobs").update({ status: "publishing", attempt, last_request_at: requestedAt, next_attempt_at: null, failure_message: null }).eq("id", job.id);
      await supabase.from("content_items").update({ status: "publishing", publication_state: "publishing", failure_message: null }).eq("id", item.id);
      const requestPayload = (job.approved_payload || {}) as DbRecord;
      const { data: attemptRecord, error: attemptError } = await supabase.from("content_publish_attempts").insert({ publish_job_id: job.id, content_item_id: item.id, attempt, approved_content_hash: String(job.approved_content_hash || "legacy"), idempotency_key: String(job.idempotency_key || `${job.platform}:${item.id}`), request_payload: requestPayload }).select("id").single();
      if (attemptError || !attemptRecord) throw attemptError || new Error("Could not create the publication attempt audit record.");
      attemptId = String(attemptRecord.id);
      const result = await publishContent(supabase, job as DbRecord, item);
      const completedAt = new Date().toISOString();
      await supabase.from("content_publish_attempts").update({ outcome: "published", response_status: result.responseStatus, response_body: result.responseBody, completed_at: completedAt }).eq("id", attemptId);
      await supabase.from("content_publish_jobs").update({ status: "published", final_url: result.finalUrl, external_job_id: result.externalId, provider_response: result.responseBody, validation_errors: [], failure_message: null, retryable: false, next_attempt_at: null, published_at: completedAt }).eq("id", job.id);
      published.push({ content_item_id: job.content_item_id, final_url: result.finalUrl });
    } catch (publishFailure) {
      const providerFailure = publishFailure instanceof PublicationProviderError ? publishFailure : null;
      const message = publishFailure instanceof Error ? publishFailure.message : "Publishing failed.";
      const retryable = providerFailure?.retryable !== false && attempt < Number(job.max_attempts || 5);
      const validationErrors = providerFailure?.validationErrors || [];
      const nextAttemptAt = retryable ? new Date(Date.now() + Math.min(60, 5 * (2 ** Math.max(0, attempt - 1))) * 60_000).toISOString() : null;
      if (attemptId) await supabase.from("content_publish_attempts").update({ outcome: validationErrors.length ? "validation_failed" : "failed", response_status: providerFailure?.responseStatus || null, response_body: providerFailure?.responseBody || {}, error_message: message, completed_at: new Date().toISOString() }).eq("id", attemptId);
      await supabase.from("content_publish_jobs").update({ status: "failed", failure_message: message, validation_errors: validationErrors, provider_response: providerFailure?.responseBody || {}, retryable, next_attempt_at: nextAttemptAt }).eq("id", job.id);
      if (validationErrors.length || providerFailure?.retryable === false) {
        await supabase.from("content_items").update({ status: "revision_required", approval_state: "changes_requested", publication_state: "failed", failure_message: [message, ...validationErrors].filter(Boolean).join(" ") }).eq("id", item.id);
        if (item.approval_id) await supabase.from("approvals").update({ status: "changes_requested", decision_note: [message, ...validationErrors].filter(Boolean).join(" "), decided_at: new Date().toISOString() }).eq("id", item.approval_id);
        await supabase.from("content_review_events").insert({ content_item_id: item.id, event_type: "changes_requested", comment: [message, ...validationErrors].filter(Boolean).join(" "), reviewer_name: "Website publishing API" });
      } else {
        await supabase.from("content_items").update({ status: "approved", publication_state: "failed", failure_message: message }).eq("id", item.id);
      }
    }
  }
  return published;
}

export async function executeAutomationJob(supabase: SupabaseClient, jobType: AutomationJobType, options: { now?: Date; configuration?: DbRecord; scheduleId?: string; scheduledFor?: string; requestId?: string; triggerSource?: "scheduler" | "manual" | "retry" } = {}) {
  if (isLegacyContentAutomationJobType(jobType)) {
    throw new LegacyContentAutomationDisabledError("runner", jobType);
  }
  const now = options.now || new Date();
  const scheduledFor = options.scheduledFor || now.toISOString();
  const attempt = Number(options.configuration?._attempt || 1);
  const runKey = options.scheduleId
    ? `schedule:${options.scheduleId}:${scheduledFor}:attempt:${attempt}`
    : `manual:${options.requestId || crypto.randomUUID()}:${jobType}`;
  const { data: run, error } = await supabase.from("workflow_runs").insert({
    schedule_id: options.scheduleId || null, job_type: jobType, scheduled_for: scheduledFor,
    status: "running", attempt, started_at: now.toISOString(), input: options.configuration || {},
    run_key: runKey, request_id: options.requestId || null,
    trigger_source: options.triggerSource || (options.scheduleId ? "scheduler" : "manual"),
  }).select("id").single();
  if (error?.code === "23505") {
    const { data: existing } = await supabase.from("workflow_runs").select("id,status").eq("run_key", runKey).maybeSingle();
    if (existing?.id) await log(supabase, String(existing.id), "skipped_duplicate", "A duplicate automation invocation was skipped.", { run_key: runKey, request_id: options.requestId || null }, "warn");
    return { run_id: existing?.id || null, status: "skipped_duplicate", output: {} };
  }
  if (error || !run) throw error || new Error("Could not persist the workflow run.");
  try {
    await log(supabase, run.id, "run_started", `${jobType} started.`);
    let output: DbRecord;
    if (jobType === "monthly_content_item") {
      const contentItemId = String(options.configuration?.content_item_id || "");
      if (!contentItemId) throw new Error("monthly_content_item requires content_item_id.");
      output = await executeMonthlyContentItem(supabase, contentItemId, {
        shadow: options.configuration?.shadow === true,
        adoptExistingDraft: options.configuration?.adopt_existing_draft === true,
      });
    }
    else if (jobType === "monthly_content_watchdog") output = await runMonthlyContentWatchdog(supabase, now);
    else if (jobType === "monthly_generation") output = await runMonthlyGeneration(supabase, run.id, now, options.configuration || {});
    else if (jobType === "weekly_review_pack" || jobType === "publish_day_notice") output = await reviewDelivery(supabase, run.id, jobType, now, options.configuration || {});
    else if (jobType === "audit_retry") output = await runAuditRetry(supabase, run.id, options.configuration || {});
    else output = await runK2Refresh(supabase, options.configuration || {});
    await supabase.from("workflow_runs").update({ status: "succeeded", output, finished_at: new Date().toISOString() }).eq("id", run.id);
    return { run_id: run.id, status: "succeeded", output };
  } catch (failure) {
    const message = automationErrorMessage(failure);
    await log(supabase, run.id, "run_failed", message, {}, "error");
    await supabase.from("workflow_runs").update(attempt < 5 ? { status: "retrying", last_error: message, retry_at: new Date(Date.now() + 15 * 60_000).toISOString() } : { status: "failed", last_error: message, finished_at: new Date().toISOString() }).eq("id", run.id);
    throw failure;
  }
}

export async function runDueSchedules(supabase: SupabaseClient, now = new Date(), requestId = crypto.randomUUID()) {
  void requestId;
  const published: Array<Record<string, unknown>> = [];
  const { data: retries, error: retryError } = await supabase.from("workflow_runs").select("*").eq("status", "retrying").lte("retry_at", now.toISOString()).lt("attempt", 5).order("retry_at");
  if (retryError) throw retryError;
  const retryResults = (retries || []).map((retry) => ({
    status: "disabled",
    run_id: retry.id,
    retry_at: retry.retry_at,
    ...disabledAutomationResult("runner", String(retry.job_type || "")),
  }));
  const { data: schedules, error } = await supabase.from("automation_schedules").select("*").eq("enabled", true).lte("next_run_at", now.toISOString()).order("next_run_at");
  if (error) throw error;
  const results = [];
  for (const schedule of schedules || []) {
    if (isLegacyContentAutomationJobType(String(schedule.job_type))) {
      results.push({ status: "disabled", schedule_id: schedule.id, scheduled_for: schedule.next_run_at, ...disabledAutomationResult("cron_route", String(schedule.job_type || "")) });
      continue;
    }
    results.push(await executeAutomationJob(supabase, schedule.job_type as AutomationJobType, { now, scheduleId: schedule.id, scheduledFor: schedule.next_run_at, configuration: schedule.configuration || {}, requestId, triggerSource: "scheduler" }));
  }
  return [{ status: "publication_queue", published }, ...retryResults, ...results];
}
