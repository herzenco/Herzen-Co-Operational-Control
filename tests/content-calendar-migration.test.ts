import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { approvalEligibility, compareByScheduledDate, scheduledDateLabel } from "../utils/content-calendar";

const currentDate = new Date("2026-08-07T16:00:00Z");

test("approval queue includes overdue and the next seven calendar days only", () => {
  const content = new Map([
    ["overdue", { id: "overdue", status: "awaiting_tito", publish_at: "2026-08-06T13:00:00Z" }],
    ["today", { id: "today", status: "awaiting_tito", publish_at: "2026-08-07T13:00:00Z" }],
    ["boundary", { id: "boundary", status: "awaiting_tito", publish_at: "2026-08-14T23:00:00Z" }],
    ["future", { id: "future", status: "awaiting_tito", publish_at: "2026-09-03T13:00:00Z" }],
    ["cancelled", { id: "cancelled", status: "cancelled", publish_at: "2026-08-10T13:00:00Z" }],
  ]);
  assert.equal(approvalEligibility({ status: "pending", content_item_id: "overdue" }, content, currentDate), "overdue");
  assert.equal(approvalEligibility({ status: "pending", content_item_id: "today" }, content, currentDate), "actionable");
  assert.equal(approvalEligibility({ status: "pending", content_item_id: "boundary" }, content, currentDate), "actionable");
  assert.equal(approvalEligibility({ status: "pending", content_item_id: "future" }, content, currentDate), "future");
  assert.equal(approvalEligibility({ status: "pending", content_item_id: "cancelled" }, content, currentDate), "inactive");
});

test("unlinked operational approvals use due_at but linked content requires canonical publish_at", () => {
  const content = new Map([["unscheduled", { id: "unscheduled", status: "awaiting_tito", publish_at: null }]]);
  assert.equal(approvalEligibility({ status: "pending", due_at: "2026-08-10T13:00:00Z" }, content, currentDate), "actionable");
  assert.equal(approvalEligibility({ status: "pending", content_item_id: "unscheduled", due_at: "2026-08-10T13:00:00Z" }, content, currentDate), "inactive");
});

test("the current September 3 retirement packages do not enter the August queue", () => {
  const content = new Map([
    ["3b0958e9-05fb-48a2-b40a-27efd73a7fec", { id: "3b0958e9-05fb-48a2-b40a-27efd73a7fec", status: "cancelled", publish_at: null }],
    ["df3e6bd2-984d-414d-89c2-7a82c69c9815", { id: "df3e6bd2-984d-414d-89c2-7a82c69c9815", status: "cancelled", publish_at: null }],
  ]);
  for (const content_item_id of content.keys()) {
    assert.equal(approvalEligibility({ status: "pending", content_item_id, due_at: "2026-09-03T09:00:00Z" }, content, currentDate), "inactive");
  }
});

test("content is chronological with unscheduled records last", () => {
  const records = [
    { id: "none", publish_at: null, created_at: "2026-08-01" },
    { id: "later", publish_at: "2026-08-12T13:00:00Z" },
    { id: "first", publish_at: "2026-08-08T13:00:00Z" },
  ].sort(compareByScheduledDate);
  assert.deepEqual(records.map((record) => record.id), ["first", "later", "none"]);
  assert.match(scheduledDateLabel(records[0].publish_at), /Sat, Aug 8, 2026/);
});

test("OCC UI and API share the approval window and chronological helpers", () => {
  const commandCenter = readFileSync("app/command-center.tsx", "utf8");
  const collectionRoute = readFileSync("app/api/v1/[resource]/route.ts", "utf8");
  assert.match(commandCenter, /approvalEligibility/);
  assert.match(commandCenter, /compareByScheduledDate/);
  assert.match(commandCenter, /scheduledDateLabel/);
  assert.match(commandCenter, /Unscheduled/);
  assert.match(commandCenter, /Cancelled history/);
  assert.match(collectionRoute, /resource\.defaultAscending/);
});
