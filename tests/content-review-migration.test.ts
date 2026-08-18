import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isContentReviewable, isPendingApprovalActionable, rejectionHistoryFromActivity } from "../utils/content-review";

const commandCenter = readFileSync("app/command-center.tsx", "utf8");
const reviewWorkspace = readFileSync("app/content-review-workspace.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");
const resources = readFileSync("utils/api/resources.ts", "utf8");
const itemRoute = readFileSync("app/api/v1/[resource]/[id]/route.ts", "utf8");

test("content opens with properties and no publishing desk", () => {
  const contentView = commandCenter.slice(commandCenter.indexOf('function renderContent'));
  assert.ok(contentView.indexOf('className="deckPanel propertyPanel"') < contentView.indexOf('className="deckPanel publishingCalendar"'));
  assert.doesNotMatch(contentView, /Publishing desk/i);
});

test("post review records approval without automatic scheduling and opens a required rejection dialog", () => {
  assert.match(commandCenter, /openContentRejection/);
  assert.match(commandCenter, /role="dialog" aria-modal="true"/);
  assert.match(commandCenter, /autoFocus required value=\{rejectionReason\}/);
  assert.match(commandCenter, /decision_note: decisionNote \|\| null/);
  assert.match(commandCenter, /schedule_content: false/);
  assert.match(itemRoute, /rejection_reason_required/);
  assert.match(itemRoute, /status: "approved"/);
  assert.match(resources, /"decision_note"/);
});

test("mobile content review is a caption-and-creative carousel with direct decisions", () => {
  assert.match(commandCenter, /className="mobileContentCaption"/);
  assert.match(commandCenter, /className="mobilePostCreative"/);
  assert.match(commandCenter, /className="mobileReviewActions"/);
  assert.match(styles, /scroll-snap-type:x mandatory/);
  assert.match(styles, /scroll-snap-stop:always/);
  assert.match(styles, /\.mobileReviewActions\{display:grid/);
});

test("suggested Instagram posts expose one-click caption and image tools", () => {
  assert.match(commandCenter, /copyContentCaption/);
  assert.match(commandCenter, /downloadContentPicture/);
  assert.match(commandCenter, />Copy caption<\/button>/);
  assert.match(commandCenter, /Download image/);
  assert.match(commandCenter, /className="mobilePostTools"/);
  assert.match(reviewWorkspace, />Copy caption<\/button>/);
  assert.match(reviewWorkspace, /Download image/);
  assert.match(commandCenter, /onCopyCaption=\{/);
  assert.match(commandCenter, /onDownloadCreative=\{/);
  assert.match(commandCenter, /role="status" aria-live="polite"/);
  assert.match(styles, /\.mobilePostTools,\.mobileReviewActions\{display:grid/);
});

test("rejected feedback section reads immutable approval activity", () => {
  assert.match(commandCenter, /Feedback Lupe must carry forward/);
  assert.match(commandCenter, /rejectionHistoryFromActivity\(approvalActivity\)/);
  const history = rejectionHistoryFromActivity([{ id: 7, entity_type: "approvals", created_at: "2026-08-01T12:00:00Z", after_data: { id: "approval-1", content_item_id: "content-1", status: "changes_requested", decision_note: "Use less text on the visual.", decided_at: "2026-08-01T11:59:00Z" } }]);
  assert.deepEqual(history, [{ id: "7", approvalId: "approval-1", contentItemId: "content-1", decision: "changes_requested", reason: "Use less text on the visual.", decidedAt: "2026-08-01T11:59:00Z" }]);
  assert.equal(isContentReviewable("ready_for_tito"), true);
  assert.equal(isContentReviewable("ready_for_lupe"), false);
  assert.equal(isContentReviewable("revision_required"), false);
  assert.equal(isContentReviewable("drafting"), false);
});

test("desktop content review leaves the drawer for a dedicated workspace", () => {
  assert.match(commandCenter, /<ContentReviewWorkspace/);
  assert.match(commandCenter, /String\(drawer\) !== "contentPreview"/);
  assert.doesNotMatch(commandCenter, /className="contentPostMockup/);
});

test("stable review URLs open the exact authenticated content preview", () => {
  assert.match(commandCenter, /new URLSearchParams\(window\.location\.search\)\.get\("content_item"\)/);
  assert.match(commandCenter, /setDrawer\("contentPreview"\)/);
});

test("pending approvals exclude terminal linked content and terminal updates withdraw stale approvals", () => {
  const approval = { id: "approval-1", status: "pending", content_item_id: "content-1" };
  assert.equal(isPendingApprovalActionable(approval, { id: "content-1", status: "ready_for_tito" }), true);
  assert.equal(isPendingApprovalActionable(approval, { id: "content-1", status: "cancelled" }), false);
  assert.equal(isPendingApprovalActionable(approval, { id: "content-1", status: "rejected" }), false);
  assert.equal(isPendingApprovalActionable({ ...approval, status: "approved" }, { id: "content-1", status: "approved" }), false);
  assert.match(itemRoute, /status: "withdrawn"/);
  assert.match(itemRoute, /eq\("content_item_id", data\.id\)/);
  assert.match(itemRoute, /eq\("status", "pending"\)/);
});
