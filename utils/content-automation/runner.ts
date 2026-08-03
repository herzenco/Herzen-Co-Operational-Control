import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuditor } from "./auditors";
import { sendLupeDelivery, titlesAndLinksOnly } from "./delivery";
import { generatePair, planMonthlySlate, promoteEvergreenFallback } from "./generation";
import { loadLearningContext } from "./learning-context";
import { AnthropicJsonModel, OpenAIJsonModel } from "./models";
import { createReviewLink } from "./review-links";
import { buildCanonicalPackage, readyQaChecklist } from "./packages";
import { etDayStart, nextMonthStart, nextScheduledAt } from "./schedule";
import type { AutomationJobType, GeneratedAsset, PlannedTopic } from "./types";
import { publishContent } from "./publishing";

type DbRecord = Record<string, unknown>;

async function log(supabase: SupabaseClient, runId: string, event: string, message: string, context: DbRecord = {}, level = "info") {
  await supabase.from("workflow_run_logs").insert({ run_id: runId, level, event, message, context });
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

async function auditUntilGate(supabase: SupabaseClient, runId: string, item: DbRecord, asset: GeneratedAsset, topic: PlannedTopic, context: DbRecord) {
  const writer = new OpenAIJsonModel();
  const auditor = createAuditor(new AnthropicJsonModel());
  let currentAsset = asset;
  let iteration = Number(item.audit_iteration_count || 0);
  while (iteration < 10) {
    iteration += 1;
    await supabase.from("content_items").update({ audit_status: "running", audit_iteration_count: iteration }).eq("id", item.id);
    const result = await auditor.audit(currentAsset, context);
    const { error: auditError } = await supabase.from("content_audits").insert({ content_item_id: item.id, iteration, provider: result.provider, seo_score: result.seo_score, aeo_score: result.aeo_score, summary: result.summary, blockers: result.blockers, rewrite_guidance: result.rewrite_guidance, raw_response: result.raw_response || {} });
    if (auditError) throw auditError;
    if (result.passed) {
      const reviewUrl = await createReviewLink(supabase, String(item.id));
      const canonicalSnapshot = { ...currentAsset, source_links: topic.source_links };
      const { error: assetSnapshotError } = await supabase.from("content_assets").update({ metadata: { canonical_snapshot: canonicalSnapshot, immutable: true, audit_iteration: iteration } }).eq("content_item_id", item.id).in("asset_role", ["source", "delivery"]).eq("is_current", true);
      if (assetSnapshotError) throw assetSnapshotError;
      const { error } = await supabase.from("content_items").update({ ...currentAsset, status: "ready_for_lupe", audit_status: "passed", audit_iteration_count: iteration, seo_score: result.seo_score, aeo_score: result.aeo_score, audit_summary: result.summary, audit_blockers: result.blockers, review_ready_at: new Date().toISOString(), review_url: reviewUrl, qa_checklist: readyQaChecklist() }).eq("id", item.id);
      if (error) throw error;
      await log(supabase, runId, "audit_passed", `${item.title} passed SEO and AEO gates.`, { content_item_id: item.id, iteration, seo_score: result.seo_score, aeo_score: result.aeo_score, provider: result.provider });
      return { passed: true, iteration, review_url: reviewUrl };
    }
    await log(supabase, runId, "audit_failed", `${item.title} failed audit iteration ${iteration}.`, { content_item_id: item.id, seo_score: result.seo_score, aeo_score: result.aeo_score, blockers: result.blockers }, "warn");
    if (iteration % 5 === 0) {
      const payload = titlesAndLinksOnly([{ title: String(item.title), review_url: `${process.env.OCC_PUBLIC_URL || "http://localhost:3000"}/content/${item.id}` }]);
      await supabase.from("content_delivery_jobs").insert({ delivery_type: "lupe_check_in", scheduled_for: new Date().toISOString(), payload, status: "queued" });
      await sendLupeDelivery("lupe_check_in", payload.items);
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
  if (!selectedTopics.length && configuration.allow_evergreen_fallback === true && slate.evergreen_fallbacks[0]) {
    selectedTopics = [await promoteEvergreenFallback(writer, slate.evergreen_fallbacks[0], context, monthStart)];
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
    const blogAudit = await auditUntilGate(supabase, runId, blog, pair.blog, topic, context);
    const linkedinAudit = await auditUntilGate(supabase, runId, linkedin, pair.linkedin, topic, context);
    results.push({ topic: topic.title, blog: { id: blog.id, ...blogAudit }, linkedin: { id: linkedin.id, ...linkedinAudit } });
  }
  const allPassed = results.every((result) => result.blog.passed && result.linkedin.passed);
  await supabase.from("content_generation_runs").update({ status: allPassed ? "ready" : "partial", completed_at: new Date().toISOString() }).eq("id", generationRun.id);
  await log(supabase, runId, "monthly_generation_complete", `Generated ${results.length} linked content pairs.`, { evergreen_fallbacks: slate.evergreen_fallbacks, results });
  return { generation_run_id: generationRun.id, results, evergreen_fallbacks: slate.evergreen_fallbacks };
}

async function reviewDelivery(supabase: SupabaseClient, type: "weekly_review_pack" | "publish_day_notice", now: Date, configuration: DbRecord) {
  const property = await requireSingle(supabase.from("content_properties").select("id").eq("slug", String(configuration.property_slug || "herzen-co")).single(), "Herzen Co. property");
  const start = etDayStart(now);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (type === "weekly_review_pack" ? 7 : 1));
  const { data, error } = await supabase.from("content_items").select("id,title,review_url,status,publish_at").eq("property_id", property.id).gte("publish_at", start.toISOString()).lt("publish_at", end.toISOString()).not("review_url", "is", null).order("publish_at");
  if (error) throw error;
  const items = (data || []).map((item) => ({ title: item.title, review_url: item.review_url }));
  const unapproved = (data || []).some((item) => !["approved","scheduled","publishing","published"].includes(item.status));
  const mode = type === "publish_day_notice" ? (unapproved ? "final_checkpoint" : "heads_up") : undefined;
  const payload = titlesAndLinksOnly(items);
  const { data: job, error: jobError } = await supabase.from("content_delivery_jobs").insert({ delivery_type: type, scheduled_for: now.toISOString(), payload: { ...payload, mode }, status: "sending" }).select("id").single();
  if (jobError) throw jobError;
  const delivery = await sendLupeDelivery(type, items, mode);
  await supabase.from("content_delivery_jobs").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: String((delivery.provider as DbRecord | undefined)?.id || "") || null }).eq("id", job.id);
  return { count: items.length, mode };
}

async function runK2Refresh(supabase: SupabaseClient, configuration: DbRecord) {
  const property = await requireSingle(supabase.from("content_properties").select("id,slug").eq("slug", String(configuration.property_slug || "herzen-co")).single(), "Herzen Co. property");
  const context = await loadLearningContext(supabase, String(property.id));
  const { data: runs, error } = await supabase.from("content_generation_runs").update({ context_snapshot: context }).eq("property_id", property.id).in("status", ["planning","generating","auditing","partial"]).select("id");
  if (error) throw error;
  return { refreshed_at: new Date().toISOString(), generation_runs_updated: runs?.length || 0, context_counts: { prior_assets: context.prior_assets.length, review_history: context.review_history.length, audit_history: context.audit_history.length } };
}

async function runAuditRetry(supabase: SupabaseClient, runId: string) {
  const property = await requireSingle(supabase.from("content_properties").select("id").eq("slug", "herzen-co").single(), "Herzen Co. property");
  const { data, error } = await supabase.from("content_items").select("*").eq("property_id", property.id).contains("metadata", { automation_phase: 1 }).in("audit_status", ["pending","failed"]).lt("audit_iteration_count", 5).limit(10);
  if (error) throw error;
  const results = [];
  for (const item of data || []) {
    const topic = { topic_key: item.slug || item.id, title: item.title, rationale: item.brief || "", timely: true, target_audience: item.target_audience || "Herzen Co. audience", conversion_goal: item.conversion_goal || "Website visit", cta: String((item.metadata as DbRecord)?.cta || "Visit the website"), publish_at: item.publish_at, source_links: item.source_links || [] } as PlannedTopic;
    const asset = { title: item.title, body: item.body, caption: item.caption, slug: item.slug, seo_title: item.seo_title, meta_description: item.meta_description, reasoning_summary: item.reasoning_summary } as GeneratedAsset;
    results.push(await auditUntilGate(supabase, runId, item, asset, topic, {}));
  }
  const { data: publishJobs, error: publishError } = await supabase.from("content_publish_jobs").select("*,content_items(*)").eq("status", "queued").lte("scheduled_for", new Date().toISOString()).limit(10);
  if (publishError) throw publishError;
  const published = [];
  for (const job of publishJobs || []) {
    try {
      await supabase.from("content_publish_jobs").update({ status: "publishing", attempt: Number(job.attempt || 0) + 1 }).eq("id", job.id);
      const finalUrl = await publishContent(supabase, job.content_items as DbRecord, job.platform);
      await supabase.from("content_publish_jobs").update({ status: "published", final_url: finalUrl, published_at: new Date().toISOString() }).eq("id", job.id);
      published.push({ content_item_id: job.content_item_id, final_url: finalUrl });
    } catch (publishFailure) {
      await supabase.from("content_publish_jobs").update({ status: "failed", failure_message: publishFailure instanceof Error ? publishFailure.message : "Publishing failed." }).eq("id", job.id);
    }
  }
  return { retried: results.length, results, published };
}

export async function executeAutomationJob(supabase: SupabaseClient, jobType: AutomationJobType, options: { now?: Date; configuration?: DbRecord; scheduleId?: string; scheduledFor?: string } = {}) {
  const now = options.now || new Date();
  const scheduledFor = options.scheduledFor || now.toISOString();
  const attempt = Number(options.configuration?._attempt || 1);
  const { data: run, error } = await supabase.from("workflow_runs").insert({ schedule_id: options.scheduleId || null, job_type: jobType, scheduled_for: scheduledFor, status: "running", attempt, started_at: now.toISOString(), input: options.configuration || {} }).select("id").single();
  if (error || !run) throw error || new Error("Could not persist the workflow run.");
  try {
    await log(supabase, run.id, "run_started", `${jobType} started.`);
    let output: DbRecord;
    if (jobType === "monthly_generation") output = await runMonthlyGeneration(supabase, run.id, now, options.configuration || {});
    else if (jobType === "weekly_review_pack" || jobType === "publish_day_notice") output = await reviewDelivery(supabase, jobType, now, options.configuration || {});
    else if (jobType === "audit_retry") output = await runAuditRetry(supabase, run.id);
    else output = await runK2Refresh(supabase, options.configuration || {});
    await supabase.from("workflow_runs").update({ status: "succeeded", output, finished_at: new Date().toISOString() }).eq("id", run.id);
    return { run_id: run.id, status: "succeeded", output };
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : "Automation failed.";
    await log(supabase, run.id, "run_failed", message, {}, "error");
    await supabase.from("workflow_runs").update(attempt < 5 ? { status: "retrying", last_error: message, retry_at: new Date(Date.now() + 15 * 60_000).toISOString() } : { status: "failed", last_error: message, finished_at: new Date().toISOString() }).eq("id", run.id);
    throw failure;
  }
}

export async function runDueSchedules(supabase: SupabaseClient, now = new Date()) {
  const { data: retries, error: retryError } = await supabase.from("workflow_runs").select("*").eq("status", "retrying").lte("retry_at", now.toISOString()).lt("attempt", 5).order("retry_at");
  if (retryError) throw retryError;
  const retryResults = [];
  for (const retry of retries || []) {
    await supabase.from("workflow_runs").update({ status: "cancelled", finished_at: now.toISOString(), output: { retry_dispatched: true } }).eq("id", retry.id);
    const configuration = { ...(retry.input as DbRecord), _attempt: Number(retry.attempt) + 1 };
    try { retryResults.push(await executeAutomationJob(supabase, retry.job_type as AutomationJobType, { now, configuration })); }
    catch (failure) { retryResults.push({ status: "retrying", job_type: retry.job_type, error: failure instanceof Error ? failure.message : "Retry failed." }); }
  }
  const { data: schedules, error } = await supabase.from("automation_schedules").select("*").eq("enabled", true).lte("next_run_at", now.toISOString()).order("next_run_at");
  if (error) throw error;
  const results = [];
  for (const schedule of schedules || []) {
    const scheduledFor = schedule.next_run_at;
    const nextRunAt = nextScheduledAt(schedule.job_type as AutomationJobType, new Date(scheduledFor));
    await supabase.from("automation_schedules").update({ next_run_at: nextRunAt }).eq("id", schedule.id);
    try { results.push(await executeAutomationJob(supabase, schedule.job_type as AutomationJobType, { now, configuration: schedule.configuration, scheduleId: schedule.id, scheduledFor })); }
    catch (failure) { results.push({ status: "retrying", job_type: schedule.job_type, error: failure instanceof Error ? failure.message : "Scheduled run failed." }); }
  }
  return [...retryResults, ...results];
}
