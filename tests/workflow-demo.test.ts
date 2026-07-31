import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { demoWorkflow } from "../lib/workflows/demo-workflow";
import { validateWorkflow } from "../lib/workflows/validate-workflow";

test("the Phase 3 hand-authored JSON demo is valid", () => {
  const validation = validateWorkflow(demoWorkflow);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2));
  assert.equal(demoWorkflow.trigger.type, "schedule");
  assert.ok(demoWorkflow.nodes.length > 0);
  assert.ok(demoWorkflow.edges.length > 0);
});

test("the editor toolbar exposes definition controls without execution controls", async () => {
  const source = await readFile(new URL("../app/workflows/workflow-designer.tsx", import.meta.url), "utf8");
  assert.match(source, />Validate/);
  assert.match(source, />Save/);
  assert.doesNotMatch(source, />Run</);
  assert.doesNotMatch(source, />Test</);
});

test("controlled canvas nodes preserve measured dimensions while dragging", async () => {
  const source = await readFile(new URL("../app/workflows/workflow-designer.tsx", import.meta.url), "utf8");
  assert.match(source, /measured:\s*\{\s*width:\s*NODE_WIDTH,\s*height:\s*NODE_HEIGHT\s*\}/);
});

test("blank-canvas dragging pans with the primary mouse button", async () => {
  const source = await readFile(new URL("../app/workflows/workflow-designer.tsx", import.meta.url), "utf8");
  assert.match(source, /const PAN_MOUSE_BUTTONS = \[0, 1, 2\]/);
  assert.match(source, /selectionOnDrag=\{false\}/);
  assert.match(source, /selectionKeyCode="Shift"/);
});

test("vertical workflow layout uses top inputs and bottom outputs", async () => {
  const source = await readFile(new URL("../app/workflows/workflow-node-card.tsx", import.meta.url), "utf8");
  assert.match(source, /type="target" position=\{Position\.Top\}/);
  assert.match(source, /type="source" position=\{Position\.Bottom\}/);
});
