import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const commandCenter = readFileSync("app/command-center.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");
const resources = readFileSync("utils/api/resources.ts", "utf8");

test("content opens with properties and no publishing desk", () => {
  const contentView = commandCenter.slice(commandCenter.indexOf('function renderContent'));
  assert.ok(contentView.indexOf('className="deckPanel propertyPanel"') < contentView.indexOf('className="deckPanel publishingCalendar"'));
  assert.doesNotMatch(contentView, /Publishing desk/i);
});

test("post review approves into schedule and rejects with durable feedback", () => {
  assert.match(commandCenter, /Approve & schedule/);
  assert.match(commandCenter, /Reject with feedback/);
  assert.match(commandCenter, /decision_note: contentDecisionNote\.trim\(\)/);
  assert.match(commandCenter, /body: JSON\.stringify\(\{ status: "scheduled" \}\)/);
  assert.match(resources, /"decision_note"/);
});

test("mobile content review is caption-first and horizontally swipeable", () => {
  assert.match(commandCenter, /className="mobileContentCaption"/);
  assert.match(styles, /scroll-snap-type:x mandatory/);
  assert.match(styles, /\.mobileContentCaption\{display:-webkit-box/);
});

test("rejected feedback section reads prior approval decisions", () => {
  assert.match(commandCenter, /Feedback Lupe must carry forward/);
  assert.match(commandCenter, /\["changes_requested", "declined"\]/);
  assert.match(commandCenter, /approval\.decision_note/);
});
