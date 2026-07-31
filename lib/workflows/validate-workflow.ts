import { z } from "zod";
import { CONTENT_STATUSES, TASK_STATUSES, outputHandlesFor, triggerNodeTypes, workflowNodeRegistry } from "./workflow-node-registry";
import { workflowSchema, type Workflow, type WorkflowNode } from "./workflow-schema";

export const WORKFLOW_ERROR_CODES = [
  "SCHEMA_INVALID",
  "TRIGGER_COUNT",
  "ORPHANED_NODE",
  "CYCLE_OUTSIDE_LOOP",
  "EDGE_NODE_MISSING",
  "EDGE_HANDLE_MISSING",
  "EDGE_TARGET_HAS_NO_INPUT",
  "ILLEGAL_CONTENT_STATUS_TRANSITION",
  "ILLEGAL_TASK_STATUS_TRANSITION",
  "GUARANTEED_DATABASE_REJECTION",
  "AGENT_NOT_FOUND",
  "ASSIGNMENT_NOT_ALLOWED",
] as const;

export const WORKFLOW_WARNING_CODES = [
  "AGENT_INACTIVE",
  "AGENT_LANE_MISMATCH",
] as const;

export type WorkflowValidationErrorCode = (typeof WORKFLOW_ERROR_CODES)[number];
export type WorkflowValidationError = {
  code: WorkflowValidationErrorCode;
  message: string;
  path: Array<string | number>;
  nodeId?: string;
  edgeId?: string;
  agentId?: string;
};
export type WorkflowValidationWarningCode = (typeof WORKFLOW_WARNING_CODES)[number];
export type WorkflowValidationWarning = {
  code: WorkflowValidationWarningCode;
  message: string;
  path: Array<string | number>;
  nodeId?: string;
  agentId: string;
};
export type WorkflowValidationAgent = {
  id: string;
  name?: string;
  lane: string;
  status: "active" | "paused" | "retired";
};
export type WorkflowValidationContext = { agents: readonly WorkflowValidationAgent[] };
export type WorkflowValidationResult = { valid: boolean; errors: WorkflowValidationError[]; warnings: WorkflowValidationWarning[]; workflow?: Workflow };

const contentTransitionMap: Record<(typeof CONTENT_STATUSES)[number], ReadonlySet<(typeof CONTENT_STATUSES)[number]>> = {
  idea: new Set(["research_ready", "blocked", "cancelled"]),
  research_ready: new Set(["drafting", "blocked", "cancelled"]),
  drafting: new Set(["ready_for_lupe", "blocked", "cancelled"]),
  ready_for_lupe: new Set(["awaiting_tito", "blocked", "cancelled"]),
  awaiting_tito: new Set(["approved", "revision_requested", "blocked", "cancelled"]),
  revision_requested: new Set(["research_ready", "drafting", "blocked", "cancelled"]),
  approved: new Set(["scheduled", "blocked", "cancelled"]),
  scheduled: new Set(["publishing", "blocked", "cancelled"]),
  publishing: new Set(["published", "failed", "blocked", "cancelled"]),
  published: new Set(),
  blocked: new Set(["cancelled"]),
  failed: new Set(["publishing", "cancelled"]),
  cancelled: new Set(),
};

const taskTransitionMap: Record<(typeof TASK_STATUSES)[number], ReadonlySet<(typeof TASK_STATUSES)[number]>> = {
  inbox: new Set(["in_progress", "blocked", "cancelled"]),
  in_progress: new Set(["review", "blocked", "cancelled"]),
  review: new Set(["done", "blocked", "cancelled"]),
  blocked: new Set(["cancelled"]),
  done: new Set(),
  cancelled: new Set(),
};

function schemaErrors(error: z.ZodError): WorkflowValidationError[] {
  return error.issues.map((issue) => ({ code: "SCHEMA_INVALID", message: issue.message, path: issue.path.map((part) => typeof part === "symbol" ? String(part) : part) }));
}

function allNodes(workflow: Workflow): WorkflowNode[] {
  return [workflow.trigger, ...workflow.nodes];
}

function hasCycleOutsideLoop(workflow: Workflow, nodeMap: Map<string, WorkflowNode>): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of allNodes(workflow)) if (node.type !== "loop") adjacency.set(node.id, []);
  for (const edge of workflow.edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id) || nodeMap.get(id)?.type === "loop") return false;
    visiting.add(id);
    for (const target of adjacency.get(id) ?? []) if (visit(target)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

function guaranteesField(workflow: Workflow, targetId: string, field: "publish_at" | "final_url", nodeMap: Map<string, WorkflowNode>): boolean {
  const incoming = new Map<string, string[]>();
  for (const node of allNodes(workflow)) incoming.set(node.id, []);
  for (const edge of workflow.edges) if (incoming.has(edge.target) && nodeMap.has(edge.source)) incoming.get(edge.target)?.push(edge.source);
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const nodeSetsField = (node: WorkflowNode) => {
    if (field === "publish_at") return node.type === "schedule_content" || (node.type === "create_content_item" && Boolean(node.config.publishAt)) || (node.type === "advance_content_status" && Boolean(node.config.publishAt));
    return (node.type === "record_publication_result" && Boolean(node.config.finalUrl)) || (node.type === "create_content_item" && Boolean(node.config.finalUrl)) || (node.type === "advance_content_status" && Boolean(node.config.finalUrl));
  };
  const walk = (id: string): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return false;
    const node = nodeMap.get(id);
    if (!node) return false;
    if (nodeSetsField(node)) return true;
    const parents = incoming.get(id) ?? [];
    if (parents.length === 0) return false;
    visiting.add(id);
    const result = parents.every(walk);
    visiting.delete(id);
    memo.set(id, result);
    return result;
  };
  return walk(targetId);
}

export function validateWorkflow(input: unknown, context?: WorkflowValidationContext): WorkflowValidationResult {
  const parsed = workflowSchema.safeParse(input);
  if (!parsed.success) return { valid: false, errors: schemaErrors(parsed.error), warnings: [] };
  const workflow = parsed.data;
  const errors: WorkflowValidationError[] = [];
  const warnings: WorkflowValidationWarning[] = [];
  const nodes = allNodes(workflow);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const triggerCount = nodes.filter((node) => triggerNodeTypes.includes(node.type)).length;
  if (triggerCount !== 1) errors.push({ code: "TRIGGER_COUNT", message: `Workflow must contain exactly one trigger node; found ${triggerCount}.`, path: ["trigger"] });

  const assignmentPath = (node: WorkflowNode): Array<string | number> => node.id === workflow.trigger.id
    ? ["trigger", "assignedAgentId"]
    : ["nodes", workflow.nodes.findIndex((candidate) => candidate.id === node.id), "assignedAgentId"];
  for (const node of nodes) {
    if (node.assignedAgentId && !workflowNodeRegistry[node.type].assignable) {
      errors.push({
        code: "ASSIGNMENT_NOT_ALLOWED",
        message: `${workflowNodeRegistry[node.type].label} nodes cannot be assigned to an agent.`,
        path: assignmentPath(node),
        nodeId: node.id,
        agentId: node.assignedAgentId,
      });
    }
  }

  if (context) {
    const agents = new Map(context.agents.map((agent) => [agent.id, agent]));
    const validateAgentReference = (agentId: string, path: Array<string | number>, node?: WorkflowNode) => {
      const agent = agents.get(agentId);
      if (!agent) {
        errors.push({ code: "AGENT_NOT_FOUND", message: `Agent "${agentId}" does not exist in the current roster.`, path, nodeId: node?.id, agentId });
        return;
      }
      if (agent.status !== "active") {
        warnings.push({ code: "AGENT_INACTIVE", message: `${agent.name ?? agent.id} is ${agent.status}; assignment is allowed but needs attention.`, path, nodeId: node?.id, agentId });
      }
      if (node) {
        const definition = workflowNodeRegistry[node.type];
        const suggestedLanes = "suggestedLanes" in definition ? definition.suggestedLanes : undefined;
        if (suggestedLanes?.length && !suggestedLanes.includes(agent.lane)) {
          warnings.push({ code: "AGENT_LANE_MISMATCH", message: `${agent.name ?? agent.id} operates in "${agent.lane}", outside the suggested lane${suggestedLanes.length === 1 ? "" : "s"} for ${workflowNodeRegistry[node.type].label}: ${suggestedLanes.join(", ")}.`, path, nodeId: node.id, agentId });
        }
      }
    };
    validateAgentReference(workflow.ownerAgentId, ["ownerAgentId"]);
    for (const node of nodes) if (node.assignedAgentId) validateAgentReference(node.assignedAgentId, assignmentPath(node), node);
  }

  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  workflow.edges.forEach((edge, index) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) {
      errors.push({ code: "EDGE_NODE_MISSING", message: `Edge ${edge.id} references a missing ${!source ? "source" : "target"} node.`, path: ["edges", index], edgeId: edge.id });
      return;
    }
    const handles = outputHandlesFor(source.type, source.config);
    if (!handles.some((handle) => handle.id === edge.sourceHandle)) errors.push({ code: "EDGE_HANDLE_MISSING", message: `Edge ${edge.id} references output handle "${edge.sourceHandle}" that does not exist on ${source.type}.`, path: ["edges", index, "sourceHandle"], edgeId: edge.id, nodeId: source.id });
    if (workflowNodeRegistry[target.type].inputs.length === 0) errors.push({ code: "EDGE_TARGET_HAS_NO_INPUT", message: `Edge ${edge.id} targets ${target.type}, which does not accept incoming connections.`, path: ["edges", index, "target"], edgeId: edge.id, nodeId: target.id });
    adjacency.get(edge.source)?.push(edge.target);
  });

  const reachable = new Set<string>();
  const stack = [workflow.trigger.id];
  while (stack.length) {
    const id = stack.pop();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    stack.push(...(adjacency.get(id) ?? []));
  }
  for (const node of workflow.nodes) if (!reachable.has(node.id)) errors.push({ code: "ORPHANED_NODE", message: `Node "${node.label}" is unreachable from the workflow trigger.`, path: ["nodes"], nodeId: node.id });
  if (hasCycleOutsideLoop(workflow, nodeMap)) errors.push({ code: "CYCLE_OUTSIDE_LOOP", message: "Workflow contains a cycle that does not pass through an explicit loop node.", path: ["edges"] });

  for (const node of nodes) {
    if (node.type === "advance_content_status") {
      const from = node.config.fromStatus as (typeof CONTENT_STATUSES)[number];
      const to = node.config.toStatus as (typeof CONTENT_STATUSES)[number];
      if (!contentTransitionMap[from].has(to)) errors.push({ code: "ILLEGAL_CONTENT_STATUS_TRANSITION", message: `Illegal content transition: ${from} → ${to}.`, path: ["nodes"], nodeId: node.id });
      if (to === "scheduled" && !guaranteesField(workflow, node.id, "publish_at", nodeMap)) errors.push({ code: "GUARANTEED_DATABASE_REJECTION", message: "This path advances content to scheduled without guaranteeing publish_at; the database will reject it.", path: ["nodes"], nodeId: node.id });
      if (to === "published" && !guaranteesField(workflow, node.id, "final_url", nodeMap)) errors.push({ code: "GUARANTEED_DATABASE_REJECTION", message: "This path advances content to published without guaranteeing final_url; the database will reject it.", path: ["nodes"], nodeId: node.id });
    }
    if (node.type === "update_task" && node.config.fromStatus && node.config.status) {
      const from = node.config.fromStatus as (typeof TASK_STATUSES)[number];
      const to = node.config.status as (typeof TASK_STATUSES)[number];
      if (!taskTransitionMap[from].has(to)) errors.push({ code: "ILLEGAL_TASK_STATUS_TRANSITION", message: `Illegal task transition: ${from} → ${to}.`, path: ["nodes"], nodeId: node.id });
    }
  }

  return { valid: errors.length === 0, errors, warnings, workflow };
}
