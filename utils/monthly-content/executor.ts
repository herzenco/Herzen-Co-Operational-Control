import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AnthropicAuditor } from "../content-automation/auditors";
import { generateIndependentAsset } from "../content-automation/generation";
import { AnthropicJsonModel, OpenAIJsonModel } from "../content-automation/models";
import type { GeneratedAsset } from "../content-automation/types";
import { contentItemUrl } from "../content-item-url";
import { assertTransition, isStale, OWNER_BY_STAGE, stageIdempotencyKey, type MonthlyContentStatus } from "./lifecycle";
import { requireMonthlyContentPlanningReady } from "./planning-readiness";

type Row = Record<string, any>;
const REQUEST_ID = "REQ-20260810-122829-monthly-content-ops-root-repair";
const PLANNING_REQUIRED_STAGES = new Set<MonthlyContentStatus>([
  "planned", "research_pending", "research_ready", "editorial_ready", "drafting", "qa_in_progress", "revision_required",
]);

async function agents(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("agents").select("id,name").in("name", ["K2", "C-3PO", "Lupe"]);
  if (error) throw error;
  return Object.fromEntries((data || []).map((agent) => [agent.name, agent.id])) as Record<string, string>;
}

async function transition(supabase: SupabaseClient, item: Row, to: MonthlyContentStatus, input: {
  actor: string; actorType?: "agent" | "human" | "system" | "watchdog" | "migration"; reason: string;
  runId?: string; jobId?: string; evidence?: unknown[]; retryCount?: number; nextAction?: string; ownerAgentId?: string | null;
}) {
  const from = String(item.status) as MonthlyContentStatus;
  assertTransition(from, to);
  const now = new Date().toISOString();
  const update = {
    status: to, stage_owner_agent_id: input.ownerAgentId || null, next_action: input.nextAction || null,
    last_meaningful_activity_at: now, blocker: null, blocker_owner_agent_id: null,
  };
  const { error } = await supabase.from("content_items").update(update).eq("id", item.id).eq("status", from);
  if (error) throw error;
  const { error: eventError } = await supabase.from("monthly_content_transition_events").insert({
    request_id: item.monthly_ops_request_id || REQUEST_ID, content_item_id: item.id, from_status: from, to_status: to,
    actor_type: input.actorType || "agent", actor_id: input.actor, reason: input.reason, run_id: input.runId || null,
    job_id: input.jobId || null, evidence: input.evidence || [], retry_count: input.retryCount || 0, next_action: input.nextAction || null,
  });
  if (eventError) throw eventError;
  Object.assign(item, update);
}

async function claimJob(supabase: SupabaseClient, item: Row, stage: MonthlyContentStatus, ownerAgentId?: string) {
  const revision = Number(item.audit_iteration_count || 0);
  const key = stageIdempotencyKey(String(item.id), stage, revision);
  const { data: inserted, error } = await supabase.from("monthly_content_stage_jobs").upsert({
    content_item_id: item.id, request_id: item.monthly_ops_request_id || REQUEST_ID, stage,
    owner_agent_id: ownerAgentId || null, status: "queued", idempotency_key: key, input: { revision },
  }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("*").maybeSingle();
  if (error) throw error;
  const job = inserted || (await supabase.from("monthly_content_stage_jobs").select("*").eq("idempotency_key", key).single()).data;
  if (!job) throw new Error("Monthly content stage job was not persisted.");
  if (job.status === "succeeded") return { job, duplicate: true };
  if (job.status === "running" && job.lease_expires_at && new Date(job.lease_expires_at) > new Date()) return { job, duplicate: true };
  const leaseToken = crypto.randomUUID();
  const attempt = Number(job.attempt || 0) + 1;
  const { data: claimed, error: claimError } = await supabase.from("monthly_content_stage_jobs").update({
    status: "running", attempt, lease_token: leaseToken, lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    started_at: new Date().toISOString(), failure_message: null,
  }).eq("id", job.id).select("*").single();
  if (claimError) throw claimError;
  return { job: claimed, duplicate: false };
}

async function finish(supabase: SupabaseClient, job: Row, output: Row, evidence: unknown[] = []) {
  const { error } = await supabase.from("monthly_content_stage_jobs").update({
    status: "succeeded", output, evidence, finished_at: new Date().toISOString(), lease_token: null, lease_expires_at: null,
  }).eq("id", job.id).eq("lease_token", job.lease_token);
  if (error) throw error;
}

function currentAsset(item: Row): GeneratedAsset {
  return { title: item.title, body: item.body || "", caption: item.caption || undefined, slug: item.slug || item.id,
    seo_title: item.seo_title || item.title, meta_description: item.meta_description || "", reasoning_summary: item.reasoning_summary || "" };
}

const reviewSnapshotFields = ["title", "body", "caption", "slug", "seo_title", "meta_description", "reasoning_summary"] as const;

export function canonicalReviewSnapshotMatches(snapshot: unknown, current: GeneratedAsset) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const saved = snapshot as Row;
  return reviewSnapshotFields.every((field) => (saved[field] ?? null) === (current[field] ?? null));
}

export function findRevisionReviewAssetIds(input: {
  assets: Row[];
  currentSourceId?: string;
  currentDeliveryId?: string;
  revisionId: string;
  revisionNumber: number;
  snapshot: GeneratedAsset;
}) {
  const representsRevision = (asset: Row) => {
    const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata as Row : {};
    const explicitlyLinked = metadata.monthly_content_revision_id === input.revisionId
      && Number(metadata.monthly_content_revision) === input.revisionNumber;
    const firstRevisionFallback = input.revisionNumber === 1
      && (asset.id === input.currentSourceId || asset.id === input.currentDeliveryId)
      && metadata.monthly_content_revision_id == null;
    return (explicitlyLinked || firstRevisionFallback)
      && canonicalReviewSnapshotMatches(metadata.canonical_snapshot, input.snapshot);
  };
  return {
    sourceId: input.assets.find((asset) => asset.asset_role === "source" && representsRevision(asset))?.id as string | undefined,
    deliveryId: input.assets.find((asset) => asset.asset_role === "delivery" && representsRevision(asset))?.id as string | undefined,
  };
}

export function revisionReviewAssetId(contentItemId: string, revisionId: string, role: "source" | "delivery") {
  const hex = createHash("sha256").update(`${contentItemId}:${revisionId}:${role}`, "utf8").digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function ensureReviewPackage(supabase: SupabaseClient, item: Row, platform: "website" | "linkedin", k2Id: string) {
  let researchRecordId = item.research_record_id as string | undefined;
  if (!researchRecordId) {
    const { data: research, error: researchError } = await supabase.from("content_research_records").insert({
      content_item_id: item.id, researcher_agent_id: k2Id,
      what_is_happening: item.research_brief?.angle || item.brief || item.title,
      why_it_fits_account: item.research_brief?.audience || item.target_audience || "Herzen Co. audience",
      how_and_why_it_fits_feed: `Independent ${platform} content operation backed by the preserved research brief.`,
      current_trend_or_context: JSON.stringify(item.research_brief?.source_links || item.source_links || []),
      caption_angle: item.reasoning_summary || item.brief || item.title, suggested_posting_time: "09:00", status: "final", finalized_at: new Date().toISOString(),
    }).select("id").single();
    if (researchError || !research) throw researchError || new Error("Canonical K2 research could not be persisted.");
    researchRecordId = research.id;
  }
  const revisionNumber = Number(item.audit_iteration_count || 0);
  const { data: revision, error: revisionError } = await supabase.from("monthly_content_revisions")
    .select("id,revision")
    .eq("content_item_id", item.id)
    .eq("revision", revisionNumber)
    .maybeSingle();
  if (revisionError) throw revisionError;
  if (!revision) throw new Error("The current durable revision is required before creating a review package.");

  const snapshot = currentAsset(item);
  const { data: reviewAssets, error: assetsReadError } = await supabase.from("content_assets")
    .select("id,asset_role,is_current,metadata")
    .eq("content_item_id", item.id)
    .in("asset_role", ["source", "delivery"]);
  if (assetsReadError) throw assetsReadError;
  const revisionId = String(revision.id);
  let { sourceId, deliveryId } = findRevisionReviewAssetIds({
    assets: reviewAssets || [],
    currentSourceId: item.source_asset_id,
    currentDeliveryId: item.delivery_asset_id,
    revisionId,
    revisionNumber,
    snapshot,
  });

  const missingRoles = [!sourceId ? "source" : null, !deliveryId ? "delivery" : null].filter(Boolean) as Array<"source" | "delivery">;
  if (missingRoles.length) {
    const itemUrl = contentItemUrl(String(item.id));
    const baseMetadata = { canonical_snapshot: snapshot, platform, monthly_content_revision_id: revisionId, monthly_content_revision: revisionNumber };
    const newAssets = missingRoles.map((role) => ({
      id: revisionReviewAssetId(String(item.id), revisionId, role),
      content_item_id: item.id,
      asset_role: role,
      external_url: itemUrl,
      file_name: `${snapshot.slug}.r${revisionNumber}.${role}.json`,
      mime_type: "application/json",
      version: revisionNumber,
      is_current: true,
      metadata: role === "source"
        ? { ...baseMetadata, immutable: true }
        : { ...baseMetadata, publishable: false, shadow: item.metadata?.shadow === true },
    }));
    const { error } = await supabase.from("content_assets").upsert(newAssets, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    sourceId ||= newAssets.find((asset) => asset.asset_role === "source")?.id;
    deliveryId ||= newAssets.find((asset) => asset.asset_role === "delivery")?.id;
  }
  if (!sourceId || !deliveryId) throw new Error("Both revision-aware review assets are required.");

  const { error: currentAssetsError } = await supabase.from("content_assets").update({ is_current: true }).in("id", [sourceId, deliveryId]);
  if (currentAssetsError) throw currentAssetsError;
  const manifest = {
    ...(item.package_manifest || {}),
    revision: revisionNumber,
    revision_id: revisionId,
    caption: item.caption || item.body,
    source_asset_id: sourceId,
    delivery_asset_id: deliveryId,
    publishing_enabled: false,
  };
  const { error } = await supabase.from("content_items").update({ research_record_id: researchRecordId, source_asset_id: sourceId, delivery_asset_id: deliveryId, package_manifest: manifest }).eq("id", item.id);
  if (error) throw error;
  const [historicalSources, historicalDeliveries] = await Promise.all([
    supabase.from("content_assets").update({ is_current: false }).eq("content_item_id", item.id).eq("asset_role", "source").neq("id", sourceId),
    supabase.from("content_assets").update({ is_current: false }).eq("content_item_id", item.id).eq("asset_role", "delivery").neq("id", deliveryId),
  ]);
  if (historicalSources.error || historicalDeliveries.error) throw historicalSources.error || historicalDeliveries.error;
  Object.assign(item, { research_record_id: researchRecordId, source_asset_id: sourceId, delivery_asset_id: deliveryId, package_manifest: manifest });
}

async function ensureLupeWorkItem(supabase: SupabaseClient, item: Row, lupeId: string) {
  // Existing rows can contain legacy API asset URLs. Always publish the stable
  // browser route for the content item instead of propagating those endpoints.
  const reviewUrl = contentItemUrl(String(item.id));
  const { error: reviewUrlError } = await supabase.from("content_items").update({
    human_review_url: reviewUrl,
    review_url: reviewUrl,
  }).eq("id", item.id);
  if (reviewUrlError) throw reviewUrlError;
  Object.assign(item, { human_review_url: reviewUrl, review_url: reviewUrl });
  const payload = {
    agent_id: lupeId,
    work_item_type: "review",
    title: `Monthly content acceptance: ${item.title}`,
    summary: `QA passed for revision ${item.package_manifest?.revision || item.audit_iteration_count}; verify package and route to Tito.`,
    status: "ready",
    content_item_id: item.id,
    lane: "monthly_content_lupe",
    attachments: [{
      label: "OCC review",
      url: reviewUrl,
      revision: item.package_manifest?.revision || item.audit_iteration_count,
      revision_id: item.package_manifest?.revision_id || null,
      source_asset_id: item.source_asset_id || null,
      delivery_asset_id: item.delivery_asset_id || null,
    }],
  };
  const { data: existing, error: readError } = await supabase.from("agent_work_items").select("id").eq("content_item_id", item.id).eq("lane", "monthly_content_lupe").in("status", ["draft", "in_progress", "blocked", "ready"]).maybeSingle();
  if (readError) throw readError;
  const write = existing
    ? await supabase.from("agent_work_items").update(payload).eq("id", existing.id)
    : await supabase.from("agent_work_items").insert(payload);
  if (write.error) throw write.error;
}

export async function executeMonthlyContentItem(supabase: SupabaseClient, contentItemId: string, options: { shadow?: boolean; adoptExistingDraft?: boolean } = {}) {
  const { data: item, error } = await supabase.from("content_items").select("*,content_channels(platform)").eq("id", contentItemId).single();
  if (error || !item) throw error || new Error("Content item was not found.");
  if (options.adoptExistingDraft && item.status !== "drafting") {
    throw new Error("Existing-draft adoption requires content status drafting.");
  }
  if (PLANNING_REQUIRED_STAGES.has(item.status as MonthlyContentStatus)) {
    await requireMonthlyContentPlanningReady(supabase, item);
  }
  const identity = await agents(supabase);
  const platform = String((item.content_channels as Row)?.platform) as "website" | "linkedin";
  const writer = new OpenAIJsonModel();
  const auditor = new AnthropicAuditor(new AnthropicJsonModel());
  if (item.status === "ready_for_lupe") {
    await ensureReviewPackage(supabase, item, platform, identity.K2);
    await ensureLupeWorkItem(supabase, item, identity.Lupe);
    return { content_item_id: item.id, status: item.status, review_url: item.human_review_url || item.review_url || null, steps: 0 };
  }
  let steps = 0;
  // A serverless invocation owns exactly one durable stage. Provider latency
  // cannot strand later stages inside a single request timeout.
  while (steps++ < 1) {
    const stage = item.status as MonthlyContentStatus;
    if (["ready_for_lupe","ready_for_tito","approved","scheduled","published","performance_tracking","completed","blocked","recovery_required","rejected","cancelled","archived","superseded"].includes(stage)) break;
    const ownerName = OWNER_BY_STAGE[stage];
    const ownerId = ownerName && identity[ownerName];
    const claim = await claimJob(supabase, item, stage, ownerId);
    if (claim.duplicate) break;
    const job = claim.job;
    try {
      if (stage === "planned") {
        await finish(supabase, job, { routed_to: "K2" });
        await transition(supabase, item, "research_pending", { actor: "system", actorType: "system", reason: "Planning accepted into executable lifecycle.", jobId: job.id, ownerAgentId: identity.K2, nextAction: "K2 completes research evidence." });
      } else if (stage === "research_pending") {
        const research = Object.keys(item.research_brief || {}).length ? item.research_brief : await writer.generate<Record<string, unknown>>(
          "You are K2. Produce a concise, evidence-based research brief as JSON with angle, audience, claims, source_links, risks, and CTA. Do not draft content.",
          JSON.stringify({ title: item.title, brief: item.brief, source_links: item.source_links, platform }),
        );
        await supabase.from("content_items").update({ research_brief: research }).eq("id", item.id);
        item.research_brief = research;
        await finish(supabase, job, { research }, Array.isArray((research as Row).source_links) ? (research as Row).source_links : []);
        await transition(supabase, item, "research_ready", { actor: "K2", reason: "Research evidence is complete.", jobId: job.id, ownerAgentId: identity["C-3PO"], nextAction: "C-3PO creates the editorial package.", evidence: (research as Row).source_links || [] });
      } else if (stage === "research_ready") {
        const editorial = { platform, angle: item.research_brief?.angle || item.brief, audience: item.target_audience, conversion_goal: item.conversion_goal, cta: item.cta || item.research_brief?.CTA, guardrails: ["No politics", "No unapproved promotions", "No publishing"] };
        await supabase.from("content_items").update({ package_manifest: { ...(item.package_manifest || {}), editorial } }).eq("id", item.id);
        item.package_manifest = { ...(item.package_manifest || {}), editorial };
        await finish(supabase, job, { editorial });
        await transition(supabase, item, "editorial_ready", { actor: "C-3PO", reason: "Editorial package is complete.", jobId: job.id, nextAction: "OpenAI drafts the independent asset." });
      } else if (stage === "editorial_ready" || stage === "revision_required") {
        await finish(supabase, job, { draft_queued: true });
        await transition(supabase, item, "drafting", { actor: "OpenAI", reason: stage === "revision_required" ? "QA revision queued with prior history preserved." : "Editorial package accepted for drafting.", jobId: job.id, nextAction: "Generate the independent asset." });
      } else if (stage === "drafting") {
        const prior = currentAsset(item);
        if (options.adoptExistingDraft) {
          const revision = Number(item.audit_iteration_count || 0) + 1;
          const { error: revisionError } = await supabase.from("monthly_content_revisions").upsert({
            content_item_id: item.id,
            job_id: job.id,
            revision,
            reason: "Existing OCC draft adopted for independent QA",
            prior_snapshot: prior,
            revised_snapshot: prior,
          }, { onConflict: "content_item_id,revision" });
          if (revisionError) throw revisionError;
          const { error: itemError } = await supabase.from("content_items").update({ audit_iteration_count: revision, audit_status: "pending" }).eq("id", item.id);
          if (itemError) throw itemError;
          Object.assign(item, { audit_iteration_count: revision, audit_status: "pending" });
          await finish(supabase, job, { revision, adopted_existing_draft: true });
          await transition(supabase, item, "qa_in_progress", { actor: "OpenAI", reason: "Existing OCC draft adopted unchanged; independent Anthropic QA required.", jobId: job.id, nextAction: "Anthropic evaluates the adopted revision." });
          continue;
        }
        const { data: lupeFeedback, error: feedbackError } = await supabase.from("content_feedback")
          .select("id,body,origin_work_item_id")
          .eq("content_item_id", item.id)
          .eq("required", true)
          .eq("status", "received")
          .not("request_revision_key", "is", null)
          .order("created_at", { ascending: true });
        if (feedbackError) throw feedbackError;
        const feedbackGuidance = (lupeFeedback || []).map((feedback) => feedback.body).join("\n\n");
        const rewriteGuidance = [item.audit_summary || "", feedbackGuidance ? `Lupe editorial review feedback:\n${feedbackGuidance}` : ""].filter(Boolean).join("\n\n");
        const asset = await generateIndependentAsset(writer, { platform, title: item.title, research: item.research_brief || {}, editorialPackage: item.package_manifest?.editorial || {}, priorAsset: prior, rewriteGuidance });
        const revision = Number(item.audit_iteration_count || 0) + 1;
        const { error: revisionError } = await supabase.from("monthly_content_revisions").upsert({ content_item_id: item.id, job_id: job.id, revision, reason: revision === 1 ? "Initial generated draft" : "Independent QA revision", prior_snapshot: prior, revised_snapshot: asset }, { onConflict: "content_item_id,revision" });
        if (revisionError) throw revisionError;
        const { error: itemError } = await supabase.from("content_items").update({ ...asset, audit_iteration_count: revision, audit_status: "pending", metadata: { ...(item.metadata || {}), automation_engine: "monthly_content_v2", shadow: options.shadow === true, publishing_enabled: false, ...(platform === "linkedin" ? { website_url: process.env.HERZEN_WEBSITE_URL || "https://herzenco.co" } : {}) } }).eq("id", item.id);
        if (itemError) throw itemError;
        if ((lupeFeedback || []).length) {
          const feedbackIds = (lupeFeedback || []).map((feedback) => feedback.id);
          const { error: appliedError } = await supabase.from("content_feedback").update({
            status: "applied",
            applied_at: new Date().toISOString(),
            resolution_note: `Applied by OpenAI in Monthly Content Operations revision ${revision}.`,
            application_evidence: { applying_agent: "OpenAI", revision, revision_job_id: job.id },
          }).in("id", feedbackIds).eq("status", "received");
          if (appliedError) throw appliedError;
        }
        Object.assign(item, asset, { audit_iteration_count: revision, audit_status: "pending" });
        await finish(supabase, job, { revision, applied_feedback_ids: (lupeFeedback || []).map((feedback) => feedback.id) }, (lupeFeedback || []).map((feedback) => ({ feedback_id: feedback.id, origin_work_item_id: feedback.origin_work_item_id })));
        await transition(supabase, item, "qa_in_progress", { actor: "OpenAI", reason: "Draft completed; independent Anthropic QA required.", jobId: job.id, nextAction: "Anthropic evaluates the current revision." });
      } else if (stage === "qa_in_progress") {
        const result = await auditor.audit(currentAsset(item), { platform, research: item.research_brief, editorial: item.package_manifest?.editorial });
        const iteration = Number(item.audit_iteration_count || 1);
        await supabase.from("content_audits").upsert({ content_item_id: item.id, iteration, provider: "anthropic", seo_score: result.seo_score, aeo_score: result.aeo_score, summary: result.summary, blockers: result.blockers, rewrite_guidance: result.rewrite_guidance }, { onConflict: "content_item_id,iteration" });
        await supabase.from("content_items").update({ audit_status: result.passed ? "passed" : "failed", seo_score: result.seo_score, aeo_score: result.aeo_score, audit_summary: result.rewrite_guidance || result.summary, audit_blockers: result.blockers }).eq("id", item.id);
        await finish(supabase, job, result as unknown as Row);
        if (!result.passed) {
          if (iteration >= 10) {
            await transition(supabase, item, "recovery_required", { actor: "Anthropic", reason: "QA iteration ceiling reached.", jobId: job.id, nextAction: "Lupe resolves the QA blocker.", ownerAgentId: identity.Lupe, retryCount: iteration });
          } else await transition(supabase, item, "revision_required", { actor: "Anthropic", reason: `QA gate failed (${result.seo_score}/${result.aeo_score}); revision required.`, jobId: job.id, nextAction: "OpenAI applies QA guidance.", retryCount: iteration, evidence: result.blockers });
        } else {
          await ensureReviewPackage(supabase, item, platform, identity.K2);
          const humanUrl = contentItemUrl(String(item.id));
          await supabase.from("content_items").update({ human_review_url: humanUrl, review_url: humanUrl, review_ready_at: new Date().toISOString() }).eq("id", item.id);
          item.human_review_url = humanUrl;
          await transition(supabase, item, "ready_for_lupe", { actor: "Anthropic", reason: `Independent QA passed (${result.seo_score}/${result.aeo_score}).`, jobId: job.id, ownerAgentId: identity.Lupe, nextAction: "Lupe performs acceptance review.", evidence: [{ seo_score: result.seo_score, aeo_score: result.aeo_score, review_url: humanUrl }] });
          await ensureLupeWorkItem(supabase, item, identity.Lupe);
        }
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Monthly content stage failed.";
      const attempt = Number(job.attempt || 1);
      const terminal = attempt >= Number(job.max_attempts || 5);
      await supabase.from("monthly_content_stage_jobs").update({ status: terminal ? "recovery_required" : "retrying", failure_message: message, retry_at: terminal ? null : new Date(Date.now() + 15 * 60_000).toISOString(), lease_token: null, lease_expires_at: null }).eq("id", job.id);
      if (terminal) await transition(supabase, item, "recovery_required", { actor: "watchdog", actorType: "watchdog", reason: message, jobId: job.id, ownerAgentId: identity.Lupe, nextAction: "Lupe resolves the terminal stage failure.", retryCount: attempt });
      throw failure;
    }
  }
  return { content_item_id: item.id, status: item.status, review_url: item.human_review_url || null, steps };
}

export async function runMonthlyContentWatchdog(supabase: SupabaseClient, now = new Date()) {
  const active = ["research_pending","research_ready","editorial_ready","drafting","qa_in_progress","revision_required","ready_for_lupe","ready_for_tito","blocked","recovery_required"];
  const { data, error } = await supabase.from("content_items").select("id,status,last_meaningful_activity_at,stage_owner_agent_id,next_action").in("status", active).not("workflow_key", "is", null);
  if (error) throw error;
  const findings = [];
  for (const item of data || []) {
    const missingControl = !item.stage_owner_agent_id || !item.next_action;
    const stale = isStale(item.last_meaningful_activity_at, now);
    if (!missingControl && !stale) continue;
    const safeRetry = !["ready_for_lupe","ready_for_tito","blocked","recovery_required"].includes(item.status);
    findings.push({ content_item_id: item.id, reason: missingControl ? "missing ownership/next action" : "stale activity", action: safeRetry ? "idempotent retry eligible" : "Lupe recovery required" });
  }
  return { checked: (data || []).length, findings };
}
