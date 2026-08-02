import { z } from "zod";

const requiredText = z.string().trim().min(1, "Required");
const optionalText = z.string().trim().optional();
const valueSource = z.object({
  source: z.enum(["literal", "variable", "expression"]),
  value: requiredText,
});
const namedOutput = z.object({ id: requiredText, label: requiredText });
const literal = (value: string) => ({ source: "literal" as const, value });
const variable = (value: string) => ({ source: "variable" as const, value });

export const OCC_RESOURCES = [
  "agents", "projects", "tasks", "work_logs", "daily_updates", "approvals",
  "content_properties", "content_channels", "content_types", "content_items",
  "workflows",
] as const;
export const TASK_STATUSES = ["inbox", "in_progress", "blocked", "review", "done", "cancelled"] as const;
export const CONTENT_STATUSES = [
  "idea", "research_ready", "drafting", "ready_for_lupe", "awaiting_tito",
  "revision_requested", "approved", "scheduled", "publishing", "published",
  "blocked", "failed", "cancelled",
] as const;

export const WORKFLOW_NODE_CATEGORIES = ["trigger", "work", "agents", "approvals", "content", "logic", "data", "communication"] as const;
export type WorkflowNodeCategory = (typeof WORKFLOW_NODE_CATEGORIES)[number];
export type WorkflowNodeIcon = "cursor" | "calendar" | "database" | "transition" | "report" | "webhook" | "task" | "edit" | "log" | "project" | "agent" | "brief" | "approval" | "wait" | "content" | "publish" | "research" | "condition" | "switch" | "loop" | "delay" | "parallel" | "query" | "variable" | "transform" | "request" | "notify";
export type HandleDef = { id: string; label: string };

export type NodeDefinition<TType extends string, TSchema extends z.ZodType> = {
  type: TType;
  category: WorkflowNodeCategory;
  label: string;
  description: string;
  icon: WorkflowNodeIcon;
  inputs: readonly HandleDef[];
  outputs: readonly HandleDef[] | ((config: z.output<TSchema>) => readonly HandleDef[]);
  configSchema: TSchema;
  defaultConfig: Record<string, unknown>;
  assignable: boolean;
  suggestedLanes?: readonly string[];
  summarize?: (config: z.output<TSchema>) => string;
};

const input = [{ id: "input", label: "Input" }] as const;
const next = [{ id: "next", label: "Next" }] as const;
const trigger = <TType extends string, TSchema extends z.ZodType>(definition: Omit<NodeDefinition<TType, TSchema>, "category" | "inputs" | "outputs" | "assignable">): NodeDefinition<TType, TSchema> => ({ ...definition, category: "trigger", inputs: [], outputs: next, assignable: false });
const action = <TType extends string, TSchema extends z.ZodType>(definition: Omit<NodeDefinition<TType, TSchema>, "inputs" | "outputs" | "assignable"> & { assignable?: boolean }): NodeDefinition<TType, TSchema> => ({ ...definition, inputs: input, outputs: next, assignable: definition.assignable ?? !["logic", "data"].includes(definition.category) });

export const workflowNodeRegistry = {
  manual: trigger({ type: "manual", label: "Manual", description: "Starts when a person explicitly initiates the workflow definition.", icon: "cursor", configSchema: z.object({ inputForm: z.array(z.object({ name: requiredText, label: requiredText, type: z.enum(["text", "number", "boolean", "date", "json"]), required: z.boolean().default(false) })).default([]) }), defaultConfig: { inputForm: [] } }),
  schedule: trigger({ type: "schedule", label: "Schedule", description: "Starts on a cron schedule interpreted in America/New_York.", icon: "calendar", configSchema: z.object({ cron: requiredText, timezone: z.literal("America/New_York") }), defaultConfig: { cron: "0 9 * * 1-5", timezone: "America/New_York" }, summarize: (config) => config.cron === "0 9 * * 1-5" ? "Every weekday at 9:00 AM ET" : `${config.cron} · ET` }),
  record_event: trigger({ type: "record_event", label: "Record event", description: "Starts when an OCC record is inserted, updated, or deleted.", icon: "database", configSchema: z.object({ table: z.enum(["tasks", "content_items", "approvals", "daily_updates", "work_logs", "projects"]), event: z.enum(["insert", "update", "delete"]), fieldChange: z.object({ field: requiredText, from: optionalText, to: optionalText }).optional() }), defaultConfig: { table: "tasks", event: "update" } }),
  status_transition: trigger({ type: "status_transition", label: "Status transition", description: "Starts when a task or content item moves between two statuses.", icon: "transition", configSchema: z.discriminatedUnion("resource", [z.object({ resource: z.literal("tasks"), fromStatus: z.enum(TASK_STATUSES), toStatus: z.enum(TASK_STATUSES) }), z.object({ resource: z.literal("content_items"), fromStatus: z.enum(CONTENT_STATUSES), toStatus: z.enum(CONTENT_STATUSES) })]), defaultConfig: { resource: "tasks", fromStatus: "inbox", toStatus: "in_progress" } }),
  missing_daily_update: trigger({ type: "missing_daily_update", label: "Missing daily update", description: "Starts after a reporting cutoff when one or more agents have not reported.", icon: "report", configSchema: z.object({ cutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM"), agentScope: z.enum(["all_active", "selected"]), agentIds: z.array(z.string().uuid()).default([]) }).superRefine((config, context) => { if (config.agentScope === "selected" && config.agentIds.length === 0) context.addIssue({ code: "custom", path: ["agentIds"], message: "Select at least one agent" }); }), defaultConfig: { cutoffTime: "17:00", agentScope: "all_active", agentIds: [] } }),
  webhook: trigger({ type: "webhook", label: "Webhook", description: "Defines a signed inbound URL trigger using a named secret.", icon: "webhook", configSchema: z.object({ path: requiredText, signingSecretName: requiredText }), defaultConfig: { path: "/occ/workflows/inbound", signingSecretName: "OCC_WEBHOOK_SIGNING_SECRET" } }),

  create_task: action({ type: "create_task", category: "work", label: "Create task", description: "Defines a new OCC instruction with ownership and completion criteria.", icon: "task", configSchema: z.object({ title: valueSource, description: valueSource.optional(), projectId: valueSource.optional(), ownerAgentId: valueSource.optional(), priority: z.enum(["urgent", "high", "medium", "low"]), dueAt: valueSource.optional(), definitionOfDone: valueSource.optional(), tags: z.array(requiredText).default([]) }), defaultConfig: { title: variable("input.title"), priority: "medium", tags: [] } }),
  update_task: action({ type: "update_task", category: "work", label: "Update task", description: "Defines changes to task status, priority, owner, due date, or tags.", icon: "edit", configSchema: z.object({ taskId: valueSource, fromStatus: z.enum(TASK_STATUSES).optional(), status: z.enum(TASK_STATUSES).optional(), priority: z.enum(["urgent", "high", "medium", "low"]).optional(), ownerAgentId: valueSource.optional(), dueAt: valueSource.optional(), tags: z.array(requiredText).optional() }), defaultConfig: { taskId: variable("record.id") } }),
  create_work_log: action({ type: "create_work_log", category: "work", label: "Create work log", description: "Documents progress, a decision, blocker, deliverable, or evidence.", icon: "log", configSchema: z.object({ taskId: valueSource.optional(), agentId: valueSource, entryType: z.enum(["note", "progress", "decision", "blocker", "deliverable", "evidence"]), title: valueSource.optional(), body: valueSource }), defaultConfig: { agentId: variable("record.owner_agent_id"), entryType: "progress", body: variable("input.update") } }),
  create_project: action({ type: "create_project", category: "work", label: "Create project", description: "Defines a new project, owner, and objective set.", icon: "project", configSchema: z.object({ name: valueSource, description: valueSource.optional(), ownerAgentId: valueSource.optional(), objectives: z.array(valueSource).default([]) }), defaultConfig: { name: variable("input.name"), objectives: [] } }),
  update_project: action({ type: "update_project", category: "work", label: "Update project", description: "Defines changes to an existing project record.", icon: "edit", configSchema: z.object({ projectId: valueSource, name: valueSource.optional(), description: valueSource.optional(), status: z.enum(["planned", "active", "paused", "completed", "archived"]).optional(), ownerAgentId: valueSource.optional() }), defaultConfig: { projectId: variable("record.id") } }),

  request_daily_update: action({ type: "request_daily_update", category: "agents", label: "Request daily update", description: "Defines an update request for all active or selected agents.", icon: "report", configSchema: z.object({ agentScope: z.enum(["all_active", "selected"]), agentIds: z.array(z.string().uuid()).default([]), message: valueSource }), defaultConfig: { agentScope: "all_active", agentIds: [], message: literal("Please submit today's update.") } }),
  flag_silent_agent: action({ type: "flag_silent_agent", category: "agents", label: "Flag silent agent", description: "Marks an agent for operator attention when a report is missing.", icon: "agent", configSchema: z.object({ agentId: valueSource, reason: valueSource }), defaultConfig: { agentId: variable("record.agent_id"), reason: literal("Daily update missing after cutoff") } }),
  assign_to_agent: action({ type: "assign_to_agent", category: "agents", label: "Assign to agent", description: "Defines ownership for a task, project, or content item.", icon: "agent", configSchema: z.object({ resource: z.enum(["tasks", "projects", "content_items"]), recordId: valueSource, agentId: valueSource }), defaultConfig: { resource: "tasks", recordId: variable("record.id"), agentId: variable("input.agent_id") } }),
  compose_daily_brief: action({ type: "compose_daily_brief", category: "agents", label: "Compose daily brief", description: "Defines which OCC sources contribute to Lupe's daily brief.", icon: "brief", configSchema: z.object({ businessDate: valueSource, includeTasks: z.boolean(), includeContent: z.boolean(), includeApprovals: z.boolean(), includeDailyUpdates: z.boolean() }), defaultConfig: { businessDate: variable("business_date"), includeTasks: true, includeContent: true, includeApprovals: true, includeDailyUpdates: true } }),

  create_approval_package: action({ type: "create_approval_package", category: "approvals", label: "Create approval package", description: "Assembles a complete decision package for human review.", icon: "approval", configSchema: z.object({ title: valueSource, executiveSummary: valueSource, evidenceLinks: z.array(valueSource).default([]), risksAndTradeoffs: valueSource, recommendation: valueSource, requestingAgentId: valueSource, reviewingAgentId: valueSource.optional(), decisionDeadline: valueSource }), defaultConfig: { title: variable("input.title"), executiveSummary: variable("input.summary"), evidenceLinks: [], risksAndTradeoffs: variable("input.risks"), recommendation: variable("input.recommendation"), requestingAgentId: variable("current_agent.id"), decisionDeadline: variable("input.deadline") }, summarize: () => "Create approval package → human review" }),
  wait_for_approval_decision: { type: "wait_for_approval_decision", category: "approvals", label: "Wait for approval decision", description: "Branches on a decision made by a person in the Approvals view.", icon: "wait", inputs: input, outputs: (config: { timeoutMinutes?: number }) => [{ id: "approved", label: "Approved" }, { id: "changes_requested", label: "Changes requested" }, { id: "declined", label: "Declined" }, { id: "withdrawn", label: "Withdrawn" }, ...(config.timeoutMinutes === undefined ? [] : [{ id: "timeout", label: "Timeout" }])], configSchema: z.object({ approvalId: valueSource, timeoutMinutes: z.number().int().positive().optional() }), defaultConfig: { approvalId: variable("approval.id") }, assignable: true, suggestedLanes: ["Operations"] },

  create_content_item: action({ type: "create_content_item", category: "content", label: "Create content item", description: "Defines a content instruction within an OCC property and account.", icon: "content", configSchema: z.object({ title: valueSource, brief: valueSource.optional(), propertyId: valueSource, channelId: valueSource, contentTypeId: valueSource.optional(), ownerAgentId: valueSource.optional(), researchOwnerAgentId: valueSource.optional(), distributionMode: z.enum(["organic", "paid"]), publishAt: valueSource.optional(), finalUrl: valueSource.optional() }), defaultConfig: { title: variable("input.title"), propertyId: variable("input.property_id"), channelId: variable("input.channel_id"), distributionMode: "organic" } }),
  advance_content_status: action({ type: "advance_content_status", category: "content", label: "Advance content status", description: "Defines one legal transition in the enforced content workflow.", icon: "transition", configSchema: z.object({ contentItemId: valueSource, fromStatus: z.enum(CONTENT_STATUSES), toStatus: z.enum(CONTENT_STATUSES), publishAt: valueSource.optional(), finalUrl: valueSource.optional() }), defaultConfig: { contentItemId: variable("record.id"), fromStatus: "idea", toStatus: "research_ready" } }),
  schedule_content: action({ type: "schedule_content", category: "content", label: "Schedule content", description: "Defines the required publishing time for approved content.", icon: "calendar", configSchema: z.object({ contentItemId: valueSource, publishAt: valueSource }), defaultConfig: { contentItemId: variable("record.id"), publishAt: variable("input.publish_at") } }),
  record_publication_result: action({ type: "record_publication_result", category: "content", label: "Record publication result", description: "Documents a successful or failed publication and its evidence.", icon: "publish", configSchema: z.object({ contentItemId: valueSource, outcome: z.enum(["published", "failed"]), finalUrl: valueSource.optional(), publishedAt: valueSource.optional(), privateEvidencePath: valueSource.optional(), failureDetail: valueSource.optional() }).superRefine((config, context) => { if (config.outcome === "published" && !config.finalUrl) context.addIssue({ code: "custom", path: ["finalUrl"], message: "Published results require a final URL" }); if (config.outcome === "failed" && !config.failureDetail) context.addIssue({ code: "custom", path: ["failureDetail"], message: "Failed results require failure detail" }); }), defaultConfig: { contentItemId: variable("record.id"), outcome: "published", finalUrl: variable("publication.final_url") } }),
  request_research: action({ type: "request_research", category: "content", label: "Request research", description: "Defines the research question and evidence K2 should supply.", icon: "research", configSchema: z.object({ contentItemId: valueSource, researchAgentId: valueSource, question: valueSource, requiredEvidence: z.array(valueSource).default([]) }), defaultConfig: { contentItemId: variable("record.id"), researchAgentId: variable("k2.id"), question: variable("input.research_question"), requiredEvidence: [] }, suggestedLanes: ["Research + optimization"] }),

  condition: { type: "condition", category: "logic", label: "Condition", description: "Branches to true or false based on an expression.", icon: "condition", inputs: input, outputs: [{ id: "true", label: "True" }, { id: "false", label: "False" }], configSchema: z.object({ expression: requiredText }), defaultConfig: { expression: "record.status === 'active'" }, assignable: false },
  switch: { type: "switch", category: "logic", label: "Switch", description: "Branches through a configurable set of named cases.", icon: "switch", inputs: input, outputs: (config: { cases: Array<{ id: string; label: string }> }) => config.cases, configSchema: z.object({ expression: requiredText, cases: z.array(namedOutput).min(1) }), defaultConfig: { expression: "record.status", cases: [{ id: "default", label: "Default" }] }, assignable: false },
  loop: { type: "loop", category: "logic", label: "Loop", description: "Defines the only graph node through which a cycle is permitted.", icon: "loop", inputs: input, outputs: [{ id: "body", label: "Body" }, { id: "done", label: "Done" }], configSchema: z.object({ records: valueSource, itemVariable: requiredText, maximumIterations: z.number().int().min(1).max(1000) }), defaultConfig: { records: variable("query.results"), itemVariable: "item", maximumIterations: 100 }, assignable: false },
  delay: action({ type: "delay", category: "logic", label: "Delay", description: "Defines a duration before the next workflow step.", icon: "delay", configSchema: z.object({ duration: z.number().positive(), unit: z.enum(["seconds", "minutes", "hours", "days"]) }), defaultConfig: { duration: 5, unit: "minutes" } }),
  parallel: { type: "parallel", category: "logic", label: "Parallel", description: "Fans out through named branches and exposes a joined continuation.", icon: "parallel", inputs: input, outputs: (config: { branches: Array<{ id: string; label: string }> }) => [...config.branches, { id: "joined", label: "Joined" }], configSchema: z.object({ branches: z.array(namedOutput).min(2) }), defaultConfig: { branches: [{ id: "branch_a", label: "Branch A" }, { id: "branch_b", label: "Branch B" }] }, assignable: false },

  query_records: action({ type: "query_records", category: "data", label: "Query records", description: "Defines a paginated OCC resource query using supported API filters.", icon: "query", configSchema: z.object({ resource: z.enum(OCC_RESOURCES), filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])), limit: z.number().int().min(1).max(500), resultVariable: requiredText }), defaultConfig: { resource: "tasks", filters: {}, limit: 50, resultVariable: "query.results" } }),
  set_variable: action({ type: "set_variable", category: "data", label: "Set variable", description: "Assigns a literal, variable, or expression to workflow state.", icon: "variable", configSchema: z.object({ name: requiredText, value: valueSource }), defaultConfig: { name: "result", value: variable("record.id") } }),
  transform: action({ type: "transform", category: "data", label: "Transform", description: "Maps input data through a declared expression.", icon: "transform", configSchema: z.object({ input: valueSource, expression: requiredText, resultVariable: requiredText }), defaultConfig: { input: variable("record"), expression: "input", resultVariable: "transform.result" } }),
  http_request: action({ type: "http_request", category: "data", label: "HTTP request", description: "Defines an external HTTP request with optional named credentials.", icon: "request", configSchema: z.object({ method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), url: valueSource, headers: z.record(z.string(), valueSource).default({}), body: valueSource.optional(), credentialSecretName: optionalText, resultVariable: requiredText }), defaultConfig: { method: "GET", url: variable("input.url"), headers: {}, resultVariable: "http.response" } }),

  notify: action({ type: "notify", category: "communication", label: "Notify", description: "Defines a recipient and message through an explicitly selected channel.", icon: "notify", configSchema: z.object({ recipient: valueSource, message: valueSource, channel: requiredText }), defaultConfig: { recipient: variable("input.recipient"), message: variable("input.message") } }),
} as const;

export type WorkflowNodeType = keyof typeof workflowNodeRegistry;
export const workflowNodeTypes = Object.keys(workflowNodeRegistry) as WorkflowNodeType[];
export const triggerNodeTypes = workflowNodeTypes.filter((type) => workflowNodeRegistry[type].category === "trigger");

export function parseNodeConfig<TType extends WorkflowNodeType>(type: TType, config: unknown) {
  return workflowNodeRegistry[type].configSchema.safeParse(config);
}

export function outputHandlesFor(type: WorkflowNodeType, config: unknown): readonly HandleDef[] {
  const definition = workflowNodeRegistry[type];
  const parsed = definition.configSchema.safeParse(config);
  if (!parsed.success) return typeof definition.outputs === "function" ? [] : definition.outputs;
  if (typeof definition.outputs !== "function") return definition.outputs;
  return definition.outputs(parsed.data as never);
}

export function summarizeNodeConfig(type: WorkflowNodeType, config: unknown): string {
  const definition = workflowNodeRegistry[type] as NodeDefinition<string, z.ZodType>;
  const parsed = definition.configSchema.safeParse(config);
  if (!parsed.success) return "Configuration required";
  if (definition.summarize) return definition.summarize(parsed.data as never);
  const firstValue = Object.values(parsed.data as Record<string, unknown>).find((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean");
  return firstValue === undefined ? definition.description : String(firstValue).replaceAll("_", " ");
}
