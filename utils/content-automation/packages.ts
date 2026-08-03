import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedAsset, PlannedTopic } from "./types";

type DbRecord = Record<string, unknown>;

const qaBase = {
  strategy_and_research_linked: true,
  source_asset_linked: true,
  delivery_asset_linked: true,
  platform_format_valid: true,
  posting_instructions_present: true,
};

function instructions(platform: "website" | "linkedin") {
  return platform === "website"
    ? "Publish to the Herzen Co. website using the approved title, slug, body, SEO title, and meta description. Preserve verified source links. Record the final canonical URL in OCC after publishing."
    : "Publish to the Herzen Co. LinkedIn account using the approved copy and CTA. Preserve the approved website link and formatting. Record the LinkedIn publication URL and final status in OCC after publishing.";
}

async function requireAgent(supabase: SupabaseClient, code: string) {
  const { data, error } = await supabase.from("agents").select("id").ilike("code", code).limit(1);
  if (error || !data?.[0]) throw new Error(error?.message || `${code} agent was not found.`);
  return String(data[0].id);
}

export async function buildCanonicalPackage(supabase: SupabaseClient, item: DbRecord, topic: PlannedTopic, asset: GeneratedAsset, platform: "website" | "linkedin") {
  const k2Id = await requireAgent(supabase, "K2");
  const c3poId = await requireAgent(supabase, "C-3PO");
  const publicOrigin = process.env.OCC_PUBLIC_URL || "https://operations.herzenco.co";
  const sourceUrl = `${publicOrigin}/api/v1/content-items/${item.id}`;
  const snapshot = { title: asset.title, body: asset.body, caption: asset.caption || null, slug: asset.slug, seo_title: asset.seo_title, meta_description: asset.meta_description, source_links: topic.source_links };

  const { data: research, error: researchError } = await supabase.from("content_research_records").insert({
    content_item_id: item.id,
    researcher_agent_id: k2Id,
    what_is_happening: topic.rationale,
    why_it_fits_account: `Built for ${topic.target_audience} to achieve ${topic.conversion_goal}.`,
    how_and_why_it_fits_feed: `${platform === "website" ? "Website depth and discoverability" : "LinkedIn conversation and distribution"} support the paired Herzen Co. narrative.`,
    current_trend_or_context: topic.source_links.join("\n") || null,
    caption_angle: asset.reasoning_summary,
    suggested_posting_time: new Date(topic.publish_at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }),
    status: "final",
    finalized_at: new Date().toISOString(),
  }).select("id").single();
  if (researchError || !research) throw new Error(researchError?.message || "Could not create K2 research record.");

  const { data: assets, error: assetError } = await supabase.from("content_assets").insert([
    { content_item_id: item.id, asset_role: "source", external_url: sourceUrl, file_name: `${asset.slug}.source.json`, mime_type: "application/json", metadata: { canonical_snapshot: snapshot, platform, immutable: true }, attached_by_agent_id: c3poId },
    { content_item_id: item.id, asset_role: "delivery", external_url: sourceUrl, file_name: `${asset.slug}.delivery.json`, mime_type: "application/json", metadata: { canonical_snapshot: snapshot, platform, publishable: true }, attached_by_agent_id: c3poId },
  ]).select("id,asset_role");
  if (assetError || !assets || assets.length !== 2) throw new Error(assetError?.message || "Could not create canonical package assets.");
  const sourceAsset = assets.find((entry) => entry.asset_role === "source");
  const deliveryAsset = assets.find((entry) => entry.asset_role === "delivery");

  const { data: approval, error: approvalError } = await supabase.from("approvals").insert({
    content_item_id: item.id,
    requested_by_agent_id: c3poId,
    title: `Approve ${platform === "website" ? "website blog" : "LinkedIn post"} — ${asset.title}`,
    summary: asset.reasoning_summary,
    evidence: [{ research_record_id: research.id }, { source_asset_id: sourceAsset?.id }, { delivery_asset_id: deliveryAsset?.id }],
    recommendation: "Review and approve, request changes, or decline this asset independently in OCC.",
    due_at: topic.publish_at,
    status: "pending",
  }).select("id").single();
  if (approvalError || !approval) throw new Error(approvalError?.message || "Could not create approval request.");

  const postingInstructions = instructions(platform);
  const packageManifest = { version: 1, platform, research_record_id: research.id, source_asset_id: sourceAsset?.id, delivery_asset_id: deliveryAsset?.id, approval_id: approval.id, source_links: topic.source_links };
  const { error: updateError } = await supabase.from("content_items").update({
    research_record_id: research.id,
    research_owner_agent_id: k2Id,
    owner_agent_id: c3poId,
    source_asset_id: sourceAsset?.id,
    delivery_asset_id: deliveryAsset?.id,
    posting_instructions: postingInstructions,
    approval_id: approval.id,
    approval_state: "pending",
    package_manifest: packageManifest,
    qa_checklist: { ...qaBase, seo_aeo_gate_passed: false, independent_review_link_active: false },
  }).eq("id", item.id);
  if (updateError) throw updateError;
  return { research_id: research.id, source_asset_id: sourceAsset?.id, delivery_asset_id: deliveryAsset?.id, approval_id: approval.id, posting_instructions: postingInstructions, package_manifest: packageManifest };
}

export function readyQaChecklist() {
  return { ...qaBase, seo_aeo_gate_passed: true, independent_review_link_active: true };
}
