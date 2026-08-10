import type { SupabaseClient } from "@supabase/supabase-js";
import { AnthropicAuditor } from "../content-automation/auditors";
import { generateIndependentAsset } from "../content-automation/generation";
import { AnthropicJsonModel, OpenAIJsonModel } from "../content-automation/models";
import type { GeneratedAsset } from "../content-automation/types";
import { assertTransition, isStale, OWNER_BY_STAGE, stageIdempotencyKey, type MonthlyContentStatus } from "./lifecycle";

type Row = Record<string, any>;
const REQUEST_ID = "REQ-20260810-122829-monthly-content-ops-root-repair";

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

async function ensureReviewPackage(supabase: SupabaseClient, item: Row, platform: "website" | "linkedin") {
  let sourceId = item.source_asset_id as string | undefined;
  let deliveryId = item.delivery_asset_id as string | undefined;
  if (!sourceId || !deliveryId) {
    const snapshot = currentAsset(item);
    const origin = process.env.OCC_PUBLIC_URL || "https://operations.herzenco.co";
    const { data, error } = await supabase.from("content_assets").insert([
      { content_item_id: item.id, asset_role: "source", external_url: `${origin}/api/v1/content-items/${item.id}`, file_name: `${snapshot.slug}.source.json`, mime_type: "application/json", metadata: { canonical_snapshot: snapshot, platform, immutable: true } },
      { content_item_id: item.id, asset_role: "delivery", external_url: `${origin}/api/v1/content-items/${item.id}`, file_name: `${snapshot.slug}.delivery.json`, mime_type: "application/json", metadata: { canonical_snapshot: snapshot, platform, publishable: false, shadow: item.metadata?.shadow === true } },
    ]).select("id,asset_role");
    if (error || !data) throw error || new Error("Canonical review assets could not be persisted.");
    sourceId = data.find((asset) => asset.asset_role === "source")?.id;
    deliveryId = data.find((asset) => asset.asset_role === "delivery")?.id;
  }
  const manifest = { ...(item.package_manifest || {}), caption: item.caption || item.body, source_asset_id: sourceId, delivery_asset_id: deliveryId, publishing_enabled: false };
  const { error } = await supabase.from("content_items").update({ source_asset_id: sourceId, delivery_asset_id: deliveryId, package_manifest: manifest }).eq("id", item.id);
  if (error) throw error;
  Object.assign(item, { source_asset_id: sourceId, delivery_asset_id: deliveryId, package_manifest: manifest });
}

export async function executeMonthlyContentItem(supabase: SupabaseClient, contentItemId: string, options: { shadow?: boolean } = {}) {
  const { data: item, error } = await supabase.from("content_items").select("*,content_channels(platform)").eq("id", contentItemId).single();
  if (error || !item) throw error || new Error("Content item was not found.");
  const identity = await agents(supabase);
  const platform = String((item.content_channels as Row)?.platform) as "website" | "linkedin";
  const writer = new OpenAIJsonModel();
  const auditor = new AnthropicAuditor(new AnthropicJsonModel());
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
        const asset = await generateIndependentAsset(writer, { platform, title: item.title, research: item.research_brief || {}, editorialPackage: item.package_manifest?.editorial || {}, priorAsset: prior, rewriteGuidance: item.audit_summary || "" });
        const revision = Number(item.audit_iteration_count || 0) + 1;
        await supabase.from("monthly_content_revisions").upsert({ content_item_id: item.id, job_id: job.id, revision, reason: revision === 1 ? "Initial generated draft" : "Independent QA revision", prior_snapshot: prior, revised_snapshot: asset }, { onConflict: "content_item_id,revision" });
        await supabase.from("content_items").update({ ...asset, audit_iteration_count: revision, audit_status: "pending", metadata: { ...(item.metadata || {}), automation_engine: "monthly_content_v2", shadow: options.shadow === true, publishing_enabled: false, ...(platform === "linkedin" ? { website_url: process.env.HERZEN_WEBSITE_URL || "https://herzenco.co" } : {}) } }).eq("id", item.id);
        Object.assign(item, asset, { audit_iteration_count: revision, audit_status: "pending" });
        await finish(supabase, job, { revision });
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
          await ensureReviewPackage(supabase, item, platform);
          const humanUrl = `${process.env.OCC_PUBLIC_URL || "http://localhost:3000"}/?content_item=${item.id}`;
          await supabase.from("content_items").update({ human_review_url: humanUrl, review_url: humanUrl, review_ready_at: new Date().toISOString() }).eq("id", item.id);
          item.human_review_url = humanUrl;
          await transition(supabase, item, "ready_for_lupe", { actor: "Anthropic", reason: `Independent QA passed (${result.seo_score}/${result.aeo_score}).`, jobId: job.id, ownerAgentId: identity.Lupe, nextAction: "Lupe performs acceptance review.", evidence: [{ seo_score: result.seo_score, aeo_score: result.aeo_score, review_url: humanUrl }] });
          await supabase.from("agent_work_items").upsert({ agent_id: identity.Lupe, work_item_type: "review", title: `Monthly content acceptance: ${item.title}`, summary: "QA passed; verify package and route to Tito.", status: "ready", content_item_id: item.id, lane: "monthly_content_lupe", attachments: [{ label: "OCC review", url: humanUrl }] }, { onConflict: "content_item_id,lane" });
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
