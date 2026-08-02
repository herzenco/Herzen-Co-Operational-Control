import { z } from "zod";
import { parseNodeConfig, workflowNodeRegistry, workflowNodeTypes, type WorkflowNodeType } from "./workflow-node-registry";

export const workflowVariableSchema = z.object({
  type: z.enum(["string", "number", "boolean", "json"]),
  description: z.string().trim().optional(),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  secretName: z.string().trim().min(1).optional(),
});

export const workflowPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

type NodeConfigByType = {
  [TType in WorkflowNodeType]: z.output<(typeof workflowNodeRegistry)[TType]["configSchema"]>;
};

export type WorkflowNodeDefinition = {
  [TType in WorkflowNodeType]: {
    id: string;
    type: TType;
    position: z.output<typeof workflowPositionSchema>;
    label: string;
    assignedAgentId?: string;
    config: NodeConfigByType[TType];
  };
}[WorkflowNodeType];

const workflowNodeRuntimeSchema = z.object({
  id: z.string().trim().min(1),
  type: z.enum(workflowNodeTypes as [WorkflowNodeType, ...WorkflowNodeType[]]),
  position: workflowPositionSchema,
  label: z.string().trim().min(1),
  assignedAgentId: z.string().trim().min(1).optional(),
  config: z.record(z.string(), z.unknown()),
}).superRefine((node, context) => {
  const result = parseNodeConfig(node.type, node.config);
  if (result.success) return;
  for (const issue of result.error.issues) {
    context.addIssue({ code: "custom", path: ["config", ...issue.path], message: issue.message });
  }
});

export const workflowNodeDocumentSchema = z.object({
  id: z.string().trim().min(1),
  type: z.enum(workflowNodeTypes as [WorkflowNodeType, ...WorkflowNodeType[]]),
  position: workflowPositionSchema,
  label: z.string(),
  assignedAgentId: z.string().trim().min(1).optional(),
  config: z.record(z.string(), z.unknown()),
});

// The runtime refinement above validates config with the schema registered for
// the node's discriminant. This cast exposes that proven relationship to
// TypeScript without weakening the runtime input to `any`.
export const workflowNodeSchema = workflowNodeRuntimeSchema as unknown as z.ZodType<WorkflowNodeDefinition>;

export const workflowEdgeSchema = z.object({
  id: z.string().trim().min(1),
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
  sourceHandle: z.string().trim().min(1),
  label: z.string().trim().optional(),
});

export const workflowSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().default(""),
  version: z.number().int().positive(),
  status: z.enum(["draft", "active", "paused", "archived"]),
  ownerAgentId: z.string().trim().min(1),
  trigger: workflowNodeSchema,
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  variables: z.record(z.string(), workflowVariableSchema),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  createdBy: z.string().trim().min(1),
}).superRefine((workflow, context) => {
  const ids = [workflow.trigger.id, ...workflow.nodes.map((node) => node.id)];
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  for (const id of new Set(duplicates)) context.addIssue({ code: "custom", path: ["nodes"], message: `Duplicate node id: ${id}` });
  const edgeIds = workflow.edges.map((edge) => edge.id);
  const duplicateEdges = edgeIds.filter((id, index) => edgeIds.indexOf(id) !== index);
  for (const id of new Set(duplicateEdges)) context.addIssue({ code: "custom", path: ["edges"], message: `Duplicate edge id: ${id}` });
});

export type VariableDef = z.infer<typeof workflowVariableSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowDocumentNode = z.infer<typeof workflowNodeDocumentSchema>;
export type WorkflowDocument = Omit<Workflow, "trigger" | "nodes"> & {
  trigger: WorkflowDocumentNode;
  nodes: WorkflowDocumentNode[];
};
