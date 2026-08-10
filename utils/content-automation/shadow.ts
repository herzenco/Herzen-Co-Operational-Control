import type { SupabaseClient } from "@supabase/supabase-js";
import { ANTHROPIC_QA_RUBRIC_VERSION, AnthropicAuditor } from "./auditors";
import { generateShadowPair, MONTHLY_SHADOW_PROMPT_VERSION } from "./generation";
import { AnthropicJsonModel, OpenAIJsonModel } from "./models";
import type { GeneratedAsset, PlannedTopic } from "./types";

type DbRecord = Record<string, unknown>;

export const MONTHLY_SHADOW_JOB_TYPE = "monthly_shadow_generation";
export const MONTHLY_SHADOW_MAX_ITERATIONS = 3;

export type MonthlyShadowInput = {
  requestId: string;
  idempotencyKey: string;
  k2ResearchRecordId: string;
  editorialBrief: string;
  monthStart: string;
  topic: PlannedTopic;
  maxIterations?: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Monthly shadow generation failed.";
}

async function requireOne(query: PromiseLike<{ data: DbRecord | null; error: { message: string } | null }>, message: string) {
  const { data, error } = await query;
  if (error || !data) throw new Error(error?.message || message);
  return data;
}

async function agentId(supabase: SupabaseClient, code: string) {
  const { data, error } = await supabase.from("agents").select("id").ilike("code", code).eq("status", "active").limit(1);
  if (error || !data?.[0]) throw new Error(error?.message || `${code} is not an active OCC agent.`);
  return String(data[0].id);
}

async function createShadowItem(supabase: SupabaseClient, input: {
  itemId: string;
  propertyId: string;
  channelId: string;
  generationRunId: string;
  pairedId: string;
  requestId: string;
  idempotencyKey: string;
  asset: GeneratedAsset;
  topic: PlannedTopic;
  platform: "website" | "linkedin";
  websiteUrl: string;
}) {
  const { data, error } = await supabase.from("content_items").insert({
    id: input.itemId,
    title: input.asset.title,
    brief: input.topic.rationale,
    body: input.asset.body,
    caption: input.asset.caption || (input.platform === "linkedin" ? input.asset.body : null),
    property_id: input.propertyId,
    channel_id: input.channelId,
    distribution_mode: "organic",
    status: "drafting",
    approval_required: true,
    approval_state: "not_requested",
    publication_state: "unpublished",
    publish_at: null,
    generation_run_id: input.generationRunId,
    paired_content_item_id: input.pairedId,
    target_audience: input.topic.target_audience,
    conversion_goal: input.topic.conversion_goal,
    cta: input.topic.cta,
    slug: input.asset.slug,
    seo_title: input.asset.seo_title,
    meta_description: input.asset.meta_description,
    reasoning_summary: input.asset.reasoning_summary,
    source_links: input.topic.source_links,
    audit_status: "pending",
    metadata: {
      monthly_content_operations_shadow: true,
      activation_status: "inactive",
      content_role: input.platform === "website" ? "blog" : "linkedin_companion",
      request_id: input.requestId,
      idempotency_key: `${input.idempotencyKey}:${input.platform}`,
      planned_website_url: input.websiteUrl,
      website_url: input.websiteUrl,
      unpublished: true,
    },
  }).select("*").single();
  if (error || !data) throw new Error(error?.message || `Could not create the ${input.platform} shadow item.`);
  return data as DbRecord;
}

async function createShadowPackage(supabase: SupabaseClient, input: {
  item: DbRecord;
  asset: GeneratedAsset;
  platform: "website" | "linkedin";
  requestId: string;
  idempotencyKey: string;
  approvedResearch: DbRecord;
  k2Id: string;
  c3poId: string;
  lupeId: string;
}) {
  const sourceUrl = `${process.env.OCC_PUBLIC_URL || "https://operations.herzenco.co"}/api/v1/content-items/${input.item.id}`;
  const { data: research, error: researchError } = await supabase.from("content_research_records").insert({
    content_item_id: input.item.id,
    researcher_agent_id: input.k2Id,
    what_is_happening: input.approvedResearch.what_is_happening,
    why_it_fits_account: input.approvedResearch.why_it_fits_account,
    how_and_why_it_fits_feed: input.approvedResearch.how_and_why_it_fits_feed,
    current_trend_or_context: input.approvedResearch.current_trend_or_context,
    caption_angle: input.approvedResearch.caption_angle,
    suggested_posting_time: input.approvedResearch.suggested_posting_time,
    status: "final",
    finalized_at: new Date().toISOString(),
  }).select("id").single();
  if (researchError || !research) throw new Error(researchError?.message || "Could not preserve the approved K2 research for the shadow item.");

  const snapshot = { ...input.asset, source_links: input.item.source_links || [] };
  const { data: assets, error: assetError } = await supabase.from("content_assets").insert([
    { content_item_id: input.item.id, asset_role: "source", external_url: sourceUrl, file_name: `${input.asset.slug}.shadow-source.json`, mime_type: "application/json", metadata: { canonical_snapshot: snapshot, platform: input.platform, immutable: true, shadow_test: true }, attached_by_agent_id: input.c3poId },
    { content_item_id: input.item.id, asset_role: "delivery", external_url: sourceUrl, file_name: `${input.asset.slug}.shadow-delivery.json`, mime_type: "application/json", metadata: { canonical_snapshot: snapshot, platform: input.platform, publishable: false, shadow_test: true }, attached_by_agent_id: input.c3poId },
  ]).select("id,asset_role");
  if (assetError || !assets || assets.length !== 2) throw new Error(assetError?.message || "Could not create the shadow package assets.");
  const sourceAssetId = String(assets.find((entry) => entry.asset_role === "source")?.id || "");
  const deliveryAssetId = String(assets.find((entry) => entry.asset_role === "delivery")?.id || "");

  const baseKey = `${input.idempotencyKey}:${input.platform}`;
  const { data: researchWork, error: researchWorkError } = await supabase.from("agent_work_items").insert({
    agent_id: input.k2Id, work_item_type: "research", title: `K2 approved research — ${input.asset.title}`,
    summary: "Approved K2 research routed into an unpublished Monthly Content Operations shadow package.", status: "final",
    content_item_id: input.item.id, lane: "monthly-content-operations-shadow", request_id: input.requestId, idempotency_key: `${baseKey}:k2`,
  }).select("id").single();
  if (researchWorkError || !researchWork) throw new Error(researchWorkError?.message || "Could not route the K2 research work.");
  const { data: packageWork, error: packageWorkError } = await supabase.from("agent_work_items").insert({
    agent_id: input.c3poId, work_item_type: "organic_package", title: `C-3PO shadow package — ${input.asset.title}`,
    summary: "Package the generated asset for Lupe acceptance testing only; do not approve, schedule, or publish.", status: "draft",
    content_item_id: input.item.id, lane: "monthly-content-operations-shadow", request_id: input.requestId, idempotency_key: `${baseKey}:c3po`,
  }).select("id").single();
  if (packageWorkError || !packageWork) throw new Error(packageWorkError?.message || "Could not route the C-3PO packaging work.");
  const { data: reviewWork, error: reviewWorkError } = await supabase.from("agent_work_items").insert({
    agent_id: input.lupeId, work_item_type: "review", title: `Lupe acceptance test — ${input.asset.title}`,
    summary: "Review the unpublished shadow asset and its QA evidence. No approval, scheduling, delivery, or publication is authorized.", status: "draft",
    content_item_id: input.item.id, lane: "monthly-content-operations-shadow", request_id: input.requestId, idempotency_key: `${baseKey}:lupe`,
  }).select("id").single();
  if (reviewWorkError || !reviewWork) throw new Error(reviewWorkError?.message || "Could not route the Lupe review work.");
  const { error: dependencyError } = await supabase.from("agent_work_dependencies").insert([
    { upstream_work_item_id: researchWork.id, downstream_work_item_id: packageWork.id, required: true, notes: "Approved K2 research precedes C-3PO packaging." },
    { upstream_work_item_id: packageWork.id, downstream_work_item_id: reviewWork.id, required: true, notes: "C-3PO packaging and QA precede Lupe acceptance testing." },
  ]);
  if (dependencyError) throw dependencyError;
  const { error: packageReadyError } = await supabase.from("agent_work_items").update({ status: "final" }).eq("id", packageWork.id);
  if (packageReadyError) throw packageReadyError;

  const { error: itemError } = await supabase.from("content_items").update({
    research_record_id: research.id,
    research_owner_agent_id: input.k2Id,
    owner_agent_id: input.c3poId,
    source_asset_id: sourceAssetId,
    delivery_asset_id: deliveryAssetId,
    linked_research_work_item_id: researchWork.id,
    linked_creative_work_item_id: packageWork.id,
    posting_instructions: "UNPUBLISHED SHADOW — no publishing or scheduling action is authorized.",
    package_manifest: { version: 1, shadow_test: true, platform: input.platform, research_record_id: research.id, source_asset_id: sourceAssetId, delivery_asset_id: deliveryAssetId, review_work_item_id: reviewWork.id, publishable: false },
    qa_checklist: { approved_k2_research_linked: true, c3po_editorial_package_linked: true, source_asset_linked: true, delivery_asset_linked: true, unpublished: true, seo_aeo_gate_passed: false, lupe_acceptance_ready: false },
  }).eq("id", input.item.id);
  if (itemError) throw itemError;
  return { reviewWorkId: String(reviewWork.id), sourceAssetId, deliveryAssetId };
}

async function auditShadowAsset(supabase: SupabaseClient, input: {
  item: DbRecord;
  initialAsset: GeneratedAsset;
  topic: PlannedTopic;
  researchContext: DbRecord;
  editorialBrief: string;
  reviewWorkId: string;
  sourceAssetId: string;
  deliveryAssetId: string;
  maxIterations: number;
  platform: "website" | "linkedin";
}) {
  const auditor = new AnthropicAuditor(new AnthropicJsonModel());
  const writer = new OpenAIJsonModel();
  let asset = input.initialAsset;
  for (let iteration = 1; iteration <= input.maxIterations; iteration += 1) {
    const { error: runningError } = await supabase.from("content_items").update({ audit_status: "running", audit_iteration_count: iteration }).eq("id", input.item.id);
    if (runningError) throw runningError;
    const result = await auditor.audit(asset, { approved_k2_research: input.researchContext, editorial_brief: input.editorialBrief, intended_platform: input.platform === "website" ? "website_blog" : "linkedin" });
    const { error: auditError } = await supabase.from("content_audits").insert({
      content_item_id: input.item.id, iteration, provider: result.provider, seo_score: result.seo_score, aeo_score: result.aeo_score,
      seo_explanation: result.seo_explanation, aeo_explanation: result.aeo_explanation, summary: result.summary, blockers: result.blockers,
      rewrite_guidance: result.rewrite_guidance, model: result.model, rubric_version: result.rubric_version, trace_id: result.trace_id,
      evaluated_at: result.evaluated_at, raw_response: { ...result, passed: undefined },
    });
    if (auditError) throw auditError;
    if (result.passed) {
      const { error: itemError } = await supabase.from("content_items").update({
        ...asset, status: "ready_for_lupe", approval_state: "not_requested", publication_state: "unpublished", publish_at: null,
        audit_status: "passed", audit_iteration_count: iteration, seo_score: result.seo_score, aeo_score: result.aeo_score,
        audit_summary: result.summary, audit_blockers: result.blockers, review_ready_at: new Date().toISOString(),
        qa_checklist: { approved_k2_research_linked: true, c3po_editorial_package_linked: true, source_asset_linked: true, delivery_asset_linked: true, unpublished: true, seo_aeo_gate_passed: true, lupe_acceptance_ready: true },
      }).eq("id", input.item.id);
      if (itemError) throw itemError;
      const finalSnapshot = { ...asset, source_links: input.item.source_links || [] };
      const { error: assetError } = await supabase.from("content_assets").update({ metadata: { canonical_snapshot: finalSnapshot, platform: input.platform, publishable: false, shadow_test: true } }).in("id", [input.sourceAssetId, input.deliveryAssetId]);
      if (assetError) throw assetError;
      const { error: reviewReadyError } = await supabase.from("agent_work_items").update({ status: "ready" }).eq("id", input.reviewWorkId);
      if (reviewReadyError) throw reviewReadyError;
      return { passed: true, iteration, seo_score: result.seo_score, aeo_score: result.aeo_score };
    }
    if (iteration === input.maxIterations) {
      await supabase.from("content_items").update({ status: "blocked", audit_status: "blocked", audit_iteration_count: iteration, seo_score: result.seo_score, aeo_score: result.aeo_score, audit_summary: result.summary, audit_blockers: result.blockers, failure_message: `QA did not pass within ${input.maxIterations} iterations.` }).eq("id", input.item.id);
      await supabase.from("agent_work_items").update({ status: "blocked", notes: `QA did not pass within ${input.maxIterations} iterations.` }).eq("id", input.reviewWorkId);
      return { passed: false, blocked: true, iteration, seo_score: result.seo_score, aeo_score: result.aeo_score };
    }
    const rewrite = await generateShadowPair(writer, input.topic, input.researchContext, input.editorialBrief, result.rewrite_guidance);
    const rewrittenAsset = input.platform === "website" ? rewrite.value.blog : rewrite.value.linkedin;
    const { error: rewriteError } = await supabase.from("content_rewrite_iterations").insert({ content_item_id: input.item.id, iteration, prior_asset: asset, rewritten_asset: rewrittenAsset, audit_result: result, rewrite_guidance: result.rewrite_guidance });
    if (rewriteError) throw rewriteError;
    asset = rewrittenAsset;
    const { error: revisionError } = await supabase.from("content_items").update({ ...asset, audit_status: "failed", seo_score: result.seo_score, aeo_score: result.aeo_score, audit_summary: result.summary, audit_blockers: result.blockers, metadata: { ...(input.item.metadata as DbRecord), latest_rewrite_trace: rewrite.trace, unpublished: true } }).eq("id", input.item.id);
    if (revisionError) throw revisionError;
  }
  throw new Error("Shadow audit loop exited unexpectedly.");
}

export async function runMonthlyContentShadow(supabase: SupabaseClient, input: MonthlyShadowInput) {
  const runKey = `monthly-shadow:${input.idempotencyKey}`;
  const { data: run, error: runError } = await supabase.from("workflow_runs").insert({
    job_type: MONTHLY_SHADOW_JOB_TYPE, scheduled_for: new Date().toISOString(), status: "running", attempt: 1, max_attempts: 1,
    input: { request_id: input.requestId, idempotency_key: input.idempotencyKey, k2_research_record_id: input.k2ResearchRecordId, editorial_brief: input.editorialBrief, month_start: input.monthStart, topic: input.topic, unpublished_shadow: true },
    run_key: runKey, request_id: input.requestId, trigger_source: "manual", responsible_agent: "Lupe",
  }).select("id,status,output").single();
  if (runError?.code === "23505") {
    const { data: existing, error } = await supabase.from("workflow_runs").select("id,status,output").eq("run_key", runKey).single();
    if (error || !existing) throw error || new Error("The idempotent shadow run could not be reloaded.");
    return { run_id: existing.id, status: "skipped_duplicate", output: existing.output };
  }
  if (runError || !run) throw runError || new Error("Could not create the shadow workflow run.");

  let generationRunId: string | null = null;
  const createdItemIds: string[] = [];
  try {
    const property = await requireOne(supabase.from("content_properties").select("id,slug").eq("slug", "herzen-co").eq("status", "active").single(), "The active Herzen Co. property was not found.");
    const approvedResearch = await requireOne(supabase.from("content_research_records").select("*").eq("id", input.k2ResearchRecordId).eq("status", "final").single(), "Approved final K2 research was not found.");
    const { data: channels, error: channelsError } = await supabase.from("content_channels").select("id,platform").eq("property_id", property.id).eq("status", "active").in("platform", ["website", "linkedin"]);
    if (channelsError) throw channelsError;
    const websiteChannel = channels?.find((channel) => channel.platform === "website");
    const linkedinChannel = channels?.find((channel) => channel.platform === "linkedin");
    if (!websiteChannel || !linkedinChannel) throw new Error("Both active Herzen Co. website and LinkedIn channels are required.");
    const [k2Id, c3poId, lupeId] = await Promise.all([agentId(supabase, "K2"), agentId(supabase, "C-3PO"), agentId(supabase, "Lupe")]);
    if (String(approvedResearch.researcher_agent_id) !== k2Id) throw new Error("The supplied research record is not owned by K2.");

    const { data: generationRun, error: generationError } = await supabase.from("content_generation_runs").insert({
      property_id: property.id, month_start: input.monthStart, status: "generating", planned_topics: [input.topic],
      context_snapshot: { k2_research_record_id: input.k2ResearchRecordId, editorial_brief: input.editorialBrief }, started_at: new Date().toISOString(),
      request_id: input.requestId, idempotency_key: input.idempotencyKey, run_kind: "monthly_shadow", provider: "openai",
      prompt_version: MONTHLY_SHADOW_PROMPT_VERSION,
    }).select("id").single();
    if (generationError || !generationRun) throw generationError || new Error("Could not persist the traced shadow generation run.");
    generationRunId = String(generationRun.id);
    await supabase.from("workflow_runs").update({ generation_run_id: generationRunId }).eq("id", run.id);

    const writer = new OpenAIJsonModel();
    const generation = await generateShadowPair(writer, input.topic, approvedResearch, input.editorialBrief);
    const { error: traceError } = await supabase.from("content_generation_runs").update({
      status: "auditing", provider: generation.trace.provider, model: generation.trace.model,
      prompt_version: generation.trace.prompt_version, trace_id: generation.trace.trace_id,
    }).eq("id", generationRunId);
    if (traceError) throw traceError;

    const blogId = crypto.randomUUID();
    const linkedinId = crypto.randomUUID();
    const websiteUrl = `${process.env.HERZEN_WEBSITE_URL || "https://herzen.co"}/${generation.value.blog.slug}`;
    const blog = await createShadowItem(supabase, { itemId: blogId, propertyId: String(property.id), channelId: String(websiteChannel.id), generationRunId, pairedId: linkedinId, requestId: input.requestId, idempotencyKey: input.idempotencyKey, asset: { ...generation.value.blog }, topic: input.topic, platform: "website", websiteUrl });
    createdItemIds.push(String(blog.id));
    const linkedin = await createShadowItem(supabase, { itemId: linkedinId, propertyId: String(property.id), channelId: String(linkedinChannel.id), generationRunId, pairedId: String(blog.id), requestId: input.requestId, idempotencyKey: input.idempotencyKey, asset: generation.value.linkedin, topic: input.topic, platform: "linkedin", websiteUrl });
    createdItemIds.push(String(linkedin.id));
    await supabase.from("content_items").update({ paired_content_item_id: linkedin.id }).eq("id", blog.id);
    const { error: pairError } = await supabase.from("content_pairs").insert({ generation_run_id: generationRunId, blog_content_item_id: blog.id, linkedin_content_item_id: linkedin.id, topic_key: input.topic.topic_key });
    if (pairError) throw pairError;

    const blogPackage = await createShadowPackage(supabase, { item: blog, asset: generation.value.blog, platform: "website", requestId: input.requestId, idempotencyKey: input.idempotencyKey, approvedResearch, k2Id, c3poId, lupeId });
    const linkedinPackage = await createShadowPackage(supabase, { item: linkedin, asset: generation.value.linkedin, platform: "linkedin", requestId: input.requestId, idempotencyKey: input.idempotencyKey, approvedResearch, k2Id, c3poId, lupeId });
    const maxIterations = Math.min(MONTHLY_SHADOW_MAX_ITERATIONS, Math.max(1, input.maxIterations || MONTHLY_SHADOW_MAX_ITERATIONS));
    const blogAudit = await auditShadowAsset(supabase, { item: blog, initialAsset: generation.value.blog, topic: input.topic, researchContext: approvedResearch, editorialBrief: input.editorialBrief, reviewWorkId: blogPackage.reviewWorkId, sourceAssetId: blogPackage.sourceAssetId, deliveryAssetId: blogPackage.deliveryAssetId, maxIterations, platform: "website" });
    const linkedinAudit = await auditShadowAsset(supabase, { item: linkedin, initialAsset: generation.value.linkedin, topic: input.topic, researchContext: approvedResearch, editorialBrief: input.editorialBrief, reviewWorkId: linkedinPackage.reviewWorkId, sourceAssetId: linkedinPackage.sourceAssetId, deliveryAssetId: linkedinPackage.deliveryAssetId, maxIterations, platform: "linkedin" });
    const ready = blogAudit.passed && linkedinAudit.passed;
    const output = { generation_run_id: generationRunId, blog: { id: blog.id, ...blogAudit }, linkedin: { id: linkedin.id, ...linkedinAudit }, approval_created: false, delivery_created: false, publication_created: false };
    await supabase.from("content_generation_runs").update({ status: ready ? "ready" : "partial", completed_at: new Date().toISOString() }).eq("id", generationRunId);
    await supabase.from("workflow_runs").update({ status: ready ? "succeeded" : "failed", output, last_error: ready ? null : "One or more shadow assets did not pass QA within the iteration limit.", finished_at: new Date().toISOString() }).eq("id", run.id);
    return { run_id: run.id, status: ready ? "succeeded" : "blocked", output };
  } catch (failure) {
    const message = errorMessage(failure);
    if (createdItemIds.length) await supabase.from("content_items").update({ status: "blocked", audit_status: "blocked", approval_state: "not_requested", publication_state: "unpublished", publish_at: null, failure_message: message }).in("id", createdItemIds);
    await supabase.from("agent_work_items").update({ status: "blocked", notes: message }).eq("request_id", input.requestId).eq("lane", "monthly-content-operations-shadow");
    if (generationRunId) await supabase.from("content_generation_runs").update({ status: "failed", failure_message: message, completed_at: new Date().toISOString() }).eq("id", generationRunId);
    await supabase.from("workflow_runs").update({ status: "failed", last_error: message, finished_at: new Date().toISOString() }).eq("id", run.id);
    throw failure;
  }
}

export function validateMonthlyShadowInput(value: unknown): { ok: true; input: MonthlyShadowInput } | { ok: false; message: string } {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as DbRecord : {};
  const topic = body.topic && typeof body.topic === "object" && !Array.isArray(body.topic) ? body.topic as DbRecord : {};
  const requestId = String(body.request_id || "").trim();
  const idempotencyKey = String(body.idempotency_key || "").trim();
  const k2ResearchRecordId = String(body.k2_research_record_id || "").trim();
  const editorialBrief = String(body.editorial_brief || "").trim();
  const monthStart = String(body.month_start || "").trim();
  const requiredTopic = ["topic_key", "title", "rationale", "target_audience", "conversion_goal", "cta"];
  if (!requestId || !idempotencyKey || !k2ResearchRecordId || !editorialBrief || !/^\d{4}-\d{2}-01$/.test(monthStart) || requiredTopic.some((key) => !String(topic[key] || "").trim()) || !Array.isArray(topic.source_links)) {
    return { ok: false, message: "request_id, idempotency_key, final K2 research, editorial_brief, month_start, and the complete topic are required." };
  }
  return { ok: true, input: { requestId, idempotencyKey, k2ResearchRecordId, editorialBrief, monthStart, topic: { topic_key: String(topic.topic_key), title: String(topic.title), rationale: String(topic.rationale), timely: topic.timely === true, target_audience: String(topic.target_audience), conversion_goal: String(topic.conversion_goal), cta: String(topic.cta), publish_at: "", source_links: topic.source_links.map(String) }, maxIterations: Number(body.max_iterations || MONTHLY_SHADOW_MAX_ITERATIONS) } };
}

export { ANTHROPIC_QA_RUBRIC_VERSION, MONTHLY_SHADOW_PROMPT_VERSION };
