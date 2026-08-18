import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  baselineFromReviewBlocks,
  buildContentReviewBlocks,
  fieldsFromReviewBlocks,
  readStoredContentReview,
  wordDiff,
} from "../utils/content-review-workspace";

const commandCenter = readFileSync("app/command-center.tsx", "utf8");
const workspace = readFileSync("app/content-review-workspace.tsx", "utf8");
const styles = readFileSync("app/content-review-workspace.css", "utf8");

test("content preview opens a full review workspace instead of the drawer branch", () => {
  assert.match(commandCenter, /<ContentReviewWorkspace/);
  assert.match(commandCenter, /drawer === "contentPreview" && selectedContent/);
  assert.match(commandCenter, /String\(drawer\) !== "contentPreview"/);
  assert.match(styles, /\.contentReviewWorkspace\s*\{[^}]*position:\s*fixed/);
  assert.match(styles, /\.contentReviewWorkspace\s*\{[^}]*inset:\s*0/);
});

test("workspace exposes editing, comments, change history, decisions, and mobile sheets", () => {
  assert.match(workspace, />Editing<\/button>/);
  assert.match(workspace, />Changes<\/button>/);
  assert.match(workspace, /Accept all/);
  assert.match(workspace, /Reject all/);
  assert.match(workspace, /Comment on whole document/);
  assert.match(workspace, /data-comment-id/);
  assert.match(workspace, /Restore original/);
  assert.match(workspace, />Approve<\/button>/);
  assert.match(workspace, />Deny<\/button>/);
  assert.match(workspace, />Undo<\/button>/);
  assert.match(styles, /@media \(max-width: 899px\)/);
  assert.match(styles, /\.contentReviewRail\.open/);
  assert.match(styles, /\.contentReviewMobileBar/);
});

test("review state round-trips persisted revisions and comments from content metadata", () => {
  const stored = readStoredContentReview({
    title: "Current title",
    body: "Current body",
    caption: "Current caption",
    metadata: {
      content_review: {
        schemaVersion: 1,
        version: 4,
        baseline: { title: "Original title", body: "Original body", caption: "Original caption" },
        revisions: [{ id: "r1", blockId: "title", before: "Original title", after: "Current title", author: "Tito", createdAt: "2026-08-18T15:00:00Z", acceptedAt: null }],
        comments: [{ id: "c1", blockId: "body-0", quote: "Current", body: "Clarify this.", author: "Tito", createdAt: "2026-08-18T15:01:00Z", resolvedAt: null }],
      },
    },
  });
  assert.equal(stored.version, 4);
  assert.equal(stored.baseline.title, "Original title");
  assert.equal(stored.revisions[0].after, "Current title");
  assert.equal(stored.comments[0].quote, "Current");
});

test("review blocks map edits back to canonical title, body, and caption fields", () => {
  const item = { title: "Title", body: "First paragraph.\n\nSecond paragraph.", caption: "Caption", metadata: {} };
  const review = readStoredContentReview(item);
  const blocks = buildContentReviewBlocks(item, review).map((block) => block.id === "body-1" ? { ...block, text: "Revised paragraph." } : block);
  assert.deepEqual(fieldsFromReviewBlocks(blocks), {
    title: "Title",
    body: "First paragraph.\n\nRevised paragraph.",
    caption: "Caption",
  });
  assert.deepEqual(baselineFromReviewBlocks(blocks), fieldsFromReviewBlocks(blocks));
});

test("word diff keeps context and marks removed and inserted words", () => {
  const parts = wordDiff("Ship the draft today", "Ship the final draft tomorrow");
  assert.ok(parts.some((part) => part.type === "same" && part.value.includes("Ship")));
  assert.ok(parts.some((part) => part.type === "removed" && part.value.includes("today")));
  assert.ok(parts.some((part) => part.type === "inserted" && part.value.includes("final")));
  assert.ok(parts.some((part) => part.type === "inserted" && part.value.includes("tomorrow")));
});
