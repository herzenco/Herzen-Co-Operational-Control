import { workflowSchema, type Workflow } from "./workflow-schema";

const definition = {
  id: "wf_daily_content_readiness",
  name: "Daily content readiness review",
  description: "A hand-authored editor example that collects tomorrow's content, branches on readiness, and prepares a human approval package.",
  version: 1,
  status: "draft",
  ownerAgentId: "lupe",
  trigger: {
    id: "trigger_schedule",
    type: "schedule",
    position: { x: 40, y: 180 },
    label: "Weekday readiness check",
    config: { cron: "0 9 * * 1-5", timezone: "America/New_York" },
  },
  nodes: [
    {
      id: "query_content",
      type: "query_records",
      position: { x: 330, y: 180 },
      label: "Find tomorrow's content",
      config: { resource: "content_items", filters: { status: "ready_for_lupe" }, limit: 50, resultVariable: "content.items" },
    },
    {
      id: "check_ready",
      type: "condition",
      position: { x: 620, y: 180 },
      label: "Anything ready for Tito?",
      config: { expression: "content.items.length > 0" },
    },
    {
      id: "approval_package",
      type: "create_approval_package",
      position: { x: 910, y: 70 },
      label: "Prepare Tito's review package",
      config: {
        title: { source: "literal", value: "Tomorrow's content approval" },
        executiveSummary: { source: "variable", value: "content.summary" },
        evidenceLinks: [{ source: "variable", value: "content.review_links" }],
        risksAndTradeoffs: { source: "variable", value: "content.risks" },
        recommendation: { source: "variable", value: "content.recommendation" },
        requestingAgentId: { source: "variable", value: "lupe.id" },
        decisionDeadline: { source: "variable", value: "content.deadline" },
      },
    },
    {
      id: "wait_decision",
      type: "wait_for_approval_decision",
      position: { x: 1210, y: 70 },
      label: "Wait for Tito's decision",
      config: { approvalId: { source: "variable", value: "approval.id" }, timeoutMinutes: 720 },
    },
    {
      id: "log_outcome",
      type: "create_work_log",
      position: { x: 1510, y: 70 },
      label: "Document decision",
      config: { agentId: { source: "variable", value: "lupe.id" }, entryType: "decision", title: { source: "literal", value: "Content review decision" }, body: { source: "variable", value: "approval.decision" } },
    },
    {
      id: "log_clear",
      type: "create_work_log",
      position: { x: 910, y: 320 },
      label: "Document clear queue",
      config: { agentId: { source: "variable", value: "lupe.id" }, entryType: "progress", title: { source: "literal", value: "Content queue clear" }, body: { source: "literal", value: "No content packages required Tito's attention." } },
    },
  ],
  edges: [
    { id: "edge_schedule_query", source: "trigger_schedule", target: "query_content", sourceHandle: "next" },
    { id: "edge_query_check", source: "query_content", target: "check_ready", sourceHandle: "next" },
    { id: "edge_ready_approval", source: "check_ready", target: "approval_package", sourceHandle: "true", label: "Ready" },
    { id: "edge_clear_log", source: "check_ready", target: "log_clear", sourceHandle: "false", label: "Clear" },
    { id: "edge_approval_wait", source: "approval_package", target: "wait_decision", sourceHandle: "next" },
    { id: "edge_approved_log", source: "wait_decision", target: "log_outcome", sourceHandle: "approved", label: "Approved" },
    { id: "edge_changes_log", source: "wait_decision", target: "log_outcome", sourceHandle: "changes_requested", label: "Changes" },
    { id: "edge_declined_log", source: "wait_decision", target: "log_outcome", sourceHandle: "declined", label: "Declined" },
    { id: "edge_withdrawn_log", source: "wait_decision", target: "log_outcome", sourceHandle: "withdrawn", label: "Withdrawn" },
    { id: "edge_timeout_log", source: "wait_decision", target: "log_outcome", sourceHandle: "timeout", label: "Timeout" },
  ],
  variables: {
    "content.items": { type: "json", description: "Tomorrow's content records", required: false },
  },
  createdAt: "2026-07-31T13:00:00.000Z",
  updatedAt: "2026-07-31T13:00:00.000Z",
  createdBy: "lupe",
} satisfies Workflow;

export const demoWorkflow = workflowSchema.parse(JSON.parse(JSON.stringify(definition)));
