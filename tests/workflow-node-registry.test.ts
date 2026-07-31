import assert from "node:assert/strict";
import test from "node:test";
import { configSchemaToFieldDescriptors } from "../lib/workflows/config-field-descriptors";
import { WORKFLOW_NODE_CATEGORIES, outputHandlesFor, workflowNodeRegistry, workflowNodeTypes } from "../lib/workflows/workflow-node-registry";

test("every registry entry is complete and keyed by its type", () => {
  for (const type of workflowNodeTypes) {
    const definition = workflowNodeRegistry[type];
    assert.equal(definition.type, type);
    assert.ok(WORKFLOW_NODE_CATEGORIES.includes(definition.category));
    assert.ok(definition.label.trim().length > 0);
    assert.ok(definition.description.trim().length > 0);
    assert.ok(definition.icon.trim().length > 0);
    assert.ok(Array.isArray(definition.inputs));
    assert.ok(definition.configSchema);
    assert.equal(typeof definition.defaultConfig, "object");
  }
});

test("default configurations are schema-valid except unresolved notify channel", () => {
  for (const type of workflowNodeTypes) {
    const definition = workflowNodeRegistry[type];
    const parsed = definition.configSchema.safeParse(definition.defaultConfig);
    if (type === "notify") {
      assert.equal(parsed.success, false, "notify must require an explicit product-channel choice");
    } else {
      assert.equal(parsed.success, true, `${type} default config should parse`);
    }
  }
  assert.equal("channel" in workflowNodeRegistry.notify.defaultConfig, false);
});

test("all handles have stable non-empty unique identifiers", () => {
  for (const type of workflowNodeTypes) {
    const definition = workflowNodeRegistry[type];
    const outputs = outputHandlesFor(type, definition.defaultConfig);
    for (const handles of [definition.inputs, outputs]) {
      assert.equal(new Set(handles.map((handle) => handle.id)).size, handles.length, `${type} contains duplicate handles`);
      for (const handle of handles) {
        assert.ok(handle.id.trim().length > 0);
        assert.ok(handle.label.trim().length > 0);
      }
    }
  }
});

test("every inspector contract is generated from configSchema", () => {
  for (const type of workflowNodeTypes) {
    const fields = configSchemaToFieldDescriptors(workflowNodeRegistry[type].configSchema);
    assert.ok(fields.length > 0, `${type} should expose schema-derived form fields`);
  }
});

test("approval decisions are branches only and never action node types", () => {
  const forbidden = workflowNodeTypes.filter((type) => /^(approve|decline|set_approval|approve_content)/.test(type));
  assert.deepEqual(forbidden, []);
  assert.deepEqual(outputHandlesFor("wait_for_approval_decision", workflowNodeRegistry.wait_for_approval_decision.defaultConfig).map((handle) => handle.id), ["approved", "changes_requested", "declined", "withdrawn"]);
});

test("credentials are represented by secret names, never values", () => {
  const serialized = JSON.stringify(workflowNodeRegistry);
  assert.doesNotMatch(serialized, /password|apiKey|accessToken|refreshToken/i);
  assert.match(serialized, /SecretName/);
});
