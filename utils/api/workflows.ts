import { validateWorkflow, type WorkflowValidationError } from "../../lib/workflows/validate-workflow";
import type { WorkflowDocument } from "../../lib/workflows/workflow-schema";

export type WorkflowRow = {
  id: string;
  name: string;
  description: string;
  version: number;
  status: WorkflowDocument["status"];
  definition: WorkflowDocument;
  owner_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowVersionRow = {
  id: string;
  workflow_id: string;
  version: number;
  definition: WorkflowDocument;
  status: WorkflowDocument["status"];
  created_by: string | null;
  created_at: string;
};

export type WorkflowPayloadResult =
  | { success: true; definition: WorkflowDocument }
  | { success: false; errors: WorkflowValidationError[] };

export function workflowDefinitionFromBody(body: Record<string, unknown>): unknown {
  return body.definition ?? body;
}

export function validateWorkflowPayload(body: Record<string, unknown>): WorkflowPayloadResult {
  const candidate = workflowDefinitionFromBody(body);
  const validation = validateWorkflow(candidate);
  if (!validation.valid || !validation.workflow) return { success: false, errors: validation.errors };
  // Preserve the caller's JSON rather than Zod's parsed projection. This keeps
  // import/export forward-compatible and lossless while validation remains strict.
  return { success: true, definition: structuredClone(candidate) as WorkflowDocument };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function workflowWritePayload(definition: WorkflowDocument, actorId: string, create: boolean) {
  const id = create && isUuid(definition.id) ? definition.id : create ? crypto.randomUUID() : definition.id;
  const normalized = { ...structuredClone(definition), id };
  return {
    ...(create ? { id, owner_id: actorId, created_by: actorId } : {}),
    name: normalized.name,
    description: normalized.description,
    version: normalized.version,
    status: normalized.status,
    definition: normalized,
  };
}

export function triggerSummaryFromDefinition(definition: WorkflowDocument): string {
  const trigger = definition.trigger;
  if (trigger.type === "schedule") return String(trigger.config.cron ?? "Schedule");
  if (trigger.type === "record_event") return `${String(trigger.config.table ?? "Record")} · ${String(trigger.config.event ?? "event")}`;
  if (trigger.type === "status_transition") return `${String(trigger.config.fromStatus ?? "status")} → ${String(trigger.config.toStatus ?? "status")}`;
  return trigger.label;
}
