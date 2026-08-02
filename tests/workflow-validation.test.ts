import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflow, type WorkflowValidationContext, type WorkflowValidationErrorCode, type WorkflowValidationWarningCode } from "../lib/workflows/validate-workflow";

const now = "2026-07-31T12:00:00.000Z";
const value = (input: string) => ({ source: "literal", value: input });
const manual = { id: "trigger", type: "manual", position: { x: 0, y: 0 }, label: "Manual start", config: { inputForm: [] } };
const createTask = { id: "task", type: "create_task", position: { x: 240, y: 0 }, label: "Create task", config: { title: value("Prepare brief"), priority: "high", tags: [] } };

function workflow(overrides: Record<string, unknown> = {}) {
  return {
    id: "workflow-1",
    name: "Daily operation",
    description: "Validation fixture",
    version: 1,
    status: "draft",
    ownerAgentId: "lupe",
    trigger: manual,
    nodes: [createTask],
    edges: [{ id: "edge-1", source: "trigger", target: "task", sourceHandle: "next" }],
    variables: {},
    createdAt: now,
    updatedAt: now,
    createdBy: "tito",
    ...overrides,
  };
}

function codes(input: unknown): WorkflowValidationErrorCode[] {
  return validateWorkflow(input).errors.map((error) => error.code);
}

const roster = (overrides: Partial<WorkflowValidationContext["agents"][number]>[] = []): WorkflowValidationContext => ({
  agents: [
    { id: "lupe", name: "Lupe", lane: "Operations", status: "active" },
    { id: "k2", name: "K2", lane: "Research + optimization", status: "active" },
    ...overrides.map((agent, index) => ({ id: `agent-${index}`, lane: "Operations", status: "active" as const, ...agent })),
  ],
});

function warningCodes(input: unknown, context: WorkflowValidationContext): WorkflowValidationWarningCode[] {
  return validateWorkflow(input, context).warnings.map((warning) => warning.code);
}

test("accepts a valid workflow definition", () => {
  const result = validateWorkflow(workflow());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("requires a workflow owner agent id", () => {
  assert.ok(codes(workflow({ ownerAgentId: "" })).includes("SCHEMA_INVALID"));
});

test("rejects a workflow owner absent from the supplied roster", () => {
  const result = validateWorkflow(workflow({ ownerAgentId: "unknown" }), roster());
  assert.ok(result.errors.some((error) => error.code === "AGENT_NOT_FOUND" && error.path.join(".") === "ownerAgentId"));
});

test("rejects an assigned agent absent from the supplied roster", () => {
  const assignedTask = { ...createTask, assignedAgentId: "unknown" };
  const result = validateWorkflow(workflow({ nodes: [assignedTask] }), roster());
  assert.ok(result.errors.some((error) => error.code === "AGENT_NOT_FOUND" && error.nodeId === "task"));
});

test("rejects agent assignment on a non-assignable node", () => {
  const condition = { id: "condition", type: "condition", position: { x: 240, y: 0 }, label: "Check", assignedAgentId: "lupe", config: { expression: "true" } };
  const result = validateWorkflow(workflow({ nodes: [condition], edges: [{ id: "edge-1", source: "trigger", target: "condition", sourceHandle: "next" }] }));
  assert.ok(result.errors.some((error) => error.code === "ASSIGNMENT_NOT_ALLOWED" && error.nodeId === "condition"));
});

test("warns when an assigned agent is paused without blocking save", () => {
  const assignedTask = { ...createTask, assignedAgentId: "paused-agent" };
  const result = validateWorkflow(workflow({ nodes: [assignedTask] }), roster([{ id: "paused-agent", name: "Paused", status: "paused" }]));
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.code === "AGENT_INACTIVE" && warning.agentId === "paused-agent"));
});

test("warns when an assigned agent is retired without blocking save", () => {
  const assignedTask = { ...createTask, assignedAgentId: "retired-agent" };
  const result = validateWorkflow(workflow({ nodes: [assignedTask] }), roster([{ id: "retired-agent", name: "Retired", status: "retired" }]));
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.code === "AGENT_INACTIVE" && warning.agentId === "retired-agent"));
});

test("warns when an action is assigned outside its suggested operating lane", () => {
  const research = { id: "research", type: "request_research", position: { x: 240, y: 0 }, label: "Research", assignedAgentId: "lupe", config: { contentItemId: value("content-1"), researchAgentId: value("k2"), question: value("What performs best?"), requiredEvidence: [] } };
  const input = workflow({ nodes: [research], edges: [{ id: "edge-1", source: "trigger", target: "research", sourceHandle: "next" }] });
  const result = validateWorkflow(input, roster());
  assert.equal(result.valid, true);
  assert.ok(warningCodes(input, roster()).includes("AGENT_LANE_MISMATCH"));
});

test("does not warn when an action is assigned within its suggested operating lane", () => {
  const research = { id: "research", type: "request_research", position: { x: 240, y: 0 }, label: "Research", assignedAgentId: "k2", config: { contentItemId: value("content-1"), researchAgentId: value("k2"), question: value("What performs best?"), requiredEvidence: [] } };
  const input = workflow({ nodes: [research], edges: [{ id: "edge-1", source: "trigger", target: "research", sourceHandle: "next" }] });
  assert.equal(warningCodes(input, roster()).includes("AGENT_LANE_MISMATCH"), false);
});

test("skips roster-dependent checks when validation context is omitted", () => {
  const assignedTask = { ...createTask, assignedAgentId: "unknown" };
  const result = validateWorkflow(workflow({ ownerAgentId: "unknown", nodes: [assignedTask] }));
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.errors.some((error) => error.code === "AGENT_NOT_FOUND"), false);
});

test("rejects a workflow with zero trigger nodes", () => {
  assert.ok(codes(workflow({ trigger: createTask, nodes: [] })).includes("TRIGGER_COUNT"));
});

test("rejects a workflow with multiple trigger nodes", () => {
  const extraTrigger = { ...manual, id: "trigger-2", label: "Second trigger" };
  assert.ok(codes(workflow({ nodes: [extraTrigger, createTask] })).includes("TRIGGER_COUNT"));
});

test("rejects orphaned nodes unreachable from the trigger", () => {
  assert.ok(codes(workflow({ edges: [] })).includes("ORPHANED_NODE"));
});

test("rejects cycles that do not pass through an explicit loop node", () => {
  const condition = { id: "condition", type: "condition", position: { x: 200, y: 0 }, label: "Check", config: { expression: "true" } };
  const variable = { id: "variable", type: "set_variable", position: { x: 400, y: 0 }, label: "Set", config: { name: "flag", value: value("yes") } };
  const edges = [
    { id: "e1", source: "trigger", target: "condition", sourceHandle: "next" },
    { id: "e2", source: "condition", target: "variable", sourceHandle: "true" },
    { id: "e3", source: "variable", target: "condition", sourceHandle: "next" },
  ];
  assert.ok(codes(workflow({ nodes: [condition, variable], edges })).includes("CYCLE_OUTSIDE_LOOP"));
});

test("allows a cycle that explicitly passes through a loop node", () => {
  const loop = { id: "loop", type: "loop", position: { x: 200, y: 0 }, label: "For each", config: { records: value("items"), itemVariable: "item", maximumIterations: 10 } };
  const variable = { id: "variable", type: "set_variable", position: { x: 400, y: 0 }, label: "Set", config: { name: "flag", value: value("yes") } };
  const edges = [
    { id: "e1", source: "trigger", target: "loop", sourceHandle: "next" },
    { id: "e2", source: "loop", target: "variable", sourceHandle: "body" },
    { id: "e3", source: "variable", target: "loop", sourceHandle: "next" },
  ];
  assert.equal(codes(workflow({ nodes: [loop, variable], edges })).includes("CYCLE_OUTSIDE_LOOP"), false);
});

test("returns a schema error when a required config field is empty", () => {
  const invalid = { ...createTask, config: { ...createTask.config, title: value("") } };
  assert.ok(codes(workflow({ nodes: [invalid] })).includes("SCHEMA_INVALID"));
});

test("rejects edges that reference a missing node", () => {
  const edges = [{ id: "edge-1", source: "missing", target: "task", sourceHandle: "next" }];
  assert.ok(codes(workflow({ edges })).includes("EDGE_NODE_MISSING"));
});

test("rejects edges that reference a missing source handle", () => {
  const edges = [{ id: "edge-1", source: "trigger", target: "task", sourceHandle: "not-a-handle" }];
  assert.ok(codes(workflow({ edges })).includes("EDGE_HANDLE_MISSING"));
});

test("rejects edges that target a trigger with no input handle", () => {
  const second = { ...manual, id: "trigger-2", label: "Second trigger" };
  const edges = [{ id: "edge-1", source: "trigger", target: "trigger-2", sourceHandle: "next" }];
  assert.ok(codes(workflow({ nodes: [second], edges })).includes("EDGE_TARGET_HAS_NO_INPUT"));
});

test("rejects illegal content status transitions", () => {
  const node = { id: "advance", type: "advance_content_status", position: { x: 200, y: 0 }, label: "Skip review", config: { contentItemId: value("content-1"), fromStatus: "drafting", toStatus: "approved" } };
  assert.ok(codes(workflow({ nodes: [node], edges: [{ id: "e1", source: "trigger", target: "advance", sourceHandle: "next" }] })).includes("ILLEGAL_CONTENT_STATUS_TRANSITION"));
});

test("rejects illegal task status transitions", () => {
  const node = { id: "update", type: "update_task", position: { x: 200, y: 0 }, label: "Skip review", config: { taskId: value("task-1"), fromStatus: "in_progress", status: "done" } };
  assert.ok(codes(workflow({ nodes: [node], edges: [{ id: "e1", source: "trigger", target: "update", sourceHandle: "next" }] })).includes("ILLEGAL_TASK_STATUS_TRANSITION"));
});

test("rejects a guaranteed database failure when scheduling without publish_at", () => {
  const node = { id: "advance", type: "advance_content_status", position: { x: 200, y: 0 }, label: "Schedule", config: { contentItemId: value("content-1"), fromStatus: "approved", toStatus: "scheduled" } };
  assert.ok(codes(workflow({ nodes: [node], edges: [{ id: "e1", source: "trigger", target: "advance", sourceHandle: "next" }] })).includes("GUARANTEED_DATABASE_REJECTION"));
});

test("accepts scheduling when every path guarantees publish_at", () => {
  const schedule = { id: "schedule", type: "schedule_content", position: { x: 180, y: 0 }, label: "Set schedule", config: { contentItemId: value("content-1"), publishAt: value("2026-08-01T13:00:00-04:00") } };
  const advance = { id: "advance", type: "advance_content_status", position: { x: 360, y: 0 }, label: "Schedule", config: { contentItemId: value("content-1"), fromStatus: "approved", toStatus: "scheduled" } };
  const edges = [{ id: "e1", source: "trigger", target: "schedule", sourceHandle: "next" }, { id: "e2", source: "schedule", target: "advance", sourceHandle: "next" }];
  assert.equal(codes(workflow({ nodes: [schedule, advance], edges })).includes("GUARANTEED_DATABASE_REJECTION"), false);
});

test("rejects a guaranteed database failure when publishing without final_url", () => {
  const node = { id: "advance", type: "advance_content_status", position: { x: 200, y: 0 }, label: "Publish", config: { contentItemId: value("content-1"), fromStatus: "publishing", toStatus: "published" } };
  assert.ok(codes(workflow({ nodes: [node], edges: [{ id: "e1", source: "trigger", target: "advance", sourceHandle: "next" }] })).includes("GUARANTEED_DATABASE_REJECTION"));
});

test("accepts publishing when every path guarantees final_url", () => {
  const result = { id: "result", type: "record_publication_result", position: { x: 180, y: 0 }, label: "Record result", config: { contentItemId: value("content-1"), outcome: "published", finalUrl: value("https://example.com/post") } };
  const advance = { id: "advance", type: "advance_content_status", position: { x: 360, y: 0 }, label: "Publish", config: { contentItemId: value("content-1"), fromStatus: "publishing", toStatus: "published" } };
  const edges = [{ id: "e1", source: "trigger", target: "result", sourceHandle: "next" }, { id: "e2", source: "result", target: "advance", sourceHandle: "next" }];
  assert.equal(codes(workflow({ nodes: [result, advance], edges })).includes("GUARANTEED_DATABASE_REJECTION"), false);
});
