export type ContentReviewActivity = Record<string, unknown>;

export type ContentRejection = {
  id: string;
  approvalId: string;
  contentItemId: string;
  decision: "changes_requested" | "declined";
  reason: string;
  decidedAt: string;
};

const REVIEWABLE_CONTENT_STATUSES = new Set([
  "ready_for_tito",
]);

const TERMINAL_CONTENT_STATUSES = new Set([
  "cancelled",
  "rejected",
  "archived",
  "superseded",
]);

function record(value: unknown): ContentReviewActivity | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as ContentReviewActivity
    : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function isContentReviewable(status: unknown) {
  return REVIEWABLE_CONTENT_STATUSES.has(stringValue(status));
}

export function isPendingApprovalActionable(approval: ContentReviewActivity, linkedContent?: ContentReviewActivity) {
  if (stringValue(approval.status) !== "pending") return false;
  if (!stringValue(approval.content_item_id)) return true;
  if (!linkedContent) return true;
  return !TERMINAL_CONTENT_STATUSES.has(stringValue(linkedContent.status));
}

export function rejectionHistoryFromActivity(activity: ContentReviewActivity[]) {
  return activity.flatMap<ContentRejection>((entry) => {
    if (stringValue(entry.entity_type) !== "approvals") return [];
    const after = record(entry.after_data);
    if (!after) return [];
    const decision = stringValue(after.status);
    if (decision !== "changes_requested" && decision !== "declined") return [];
    const reason = stringValue(after.decision_note);
    const contentItemId = stringValue(after.content_item_id);
    if (!reason || !contentItemId) return [];
    return [{
      id: stringValue(entry.id) || `${stringValue(after.id)}-${stringValue(entry.created_at)}`,
      approvalId: stringValue(after.id),
      contentItemId,
      decision,
      reason,
      decidedAt: stringValue(after.decided_at) || stringValue(entry.created_at),
    }];
  });
}
