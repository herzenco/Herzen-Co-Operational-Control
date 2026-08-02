export type DeliverableRecord = {
  caption?: unknown;
  body?: unknown;
  hashtags?: unknown;
  posting_instructions?: unknown;
  tags?: unknown;
  cta?: unknown;
  approval_state?: unknown;
  source_asset_id?: unknown;
  delivery_asset_id?: unknown;
};

export type FeedbackRecord = { required?: unknown; status?: unknown };

export function deliverableBlockers(item: DeliverableRecord, feedback: FeedbackRecord[] = []) {
  const blockers: string[] = [];
  if (!String(item.caption || item.body || "").trim()) blockers.push("final_caption_missing");
  if (!item.source_asset_id) blockers.push("source_asset_missing");
  if (!item.delivery_asset_id) blockers.push("delivery_asset_missing");
  if (!String(item.posting_instructions || "").trim()) blockers.push("posting_instructions_missing");
  if (item.approval_state !== "approved") blockers.push("approval_missing");
  if (feedback.some((entry) => entry.required === true && ["received", "blocked"].includes(String(entry.status)))) {
    blockers.push("required_feedback_unresolved");
  }
  return blockers;
}

export function canonicalAssetLocation(asset: Record<string, unknown>) {
  const bucket = String(asset.storage_bucket || "").trim();
  const path = String(asset.storage_path || "").trim();
  if (bucket && path) return `storage://${bucket}/${path}`;
  return String(asset.external_url || "").trim();
}
