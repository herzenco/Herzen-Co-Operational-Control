export type ResourceName =
  | "agents"
  | "projects"
  | "tasks"
  | "work-logs"
  | "daily-updates"
  | "approvals"
  | "activity";

type ResourceConfig = {
  table: string;
  mutable: boolean;
  createFields: string[];
  updateFields: string[];
  filters: string[];
  defaultOrder: string;
};

export const resources: Record<ResourceName, ResourceConfig> = {
  agents: {
    table: "agents",
    mutable: true,
    createFields: ["code", "name", "role", "lane", "status", "charter", "instructions", "capabilities", "metadata", "auth_user_id", "reports_to"],
    updateFields: ["code", "name", "role", "lane", "status", "charter", "instructions", "capabilities", "metadata", "auth_user_id", "reports_to"],
    filters: ["code", "status", "auth_user_id", "reports_to"],
    defaultOrder: "created_at",
  },
  projects: {
    table: "projects",
    mutable: true,
    createFields: ["name", "slug", "description", "status", "owner_agent_id", "objectives", "metadata"],
    updateFields: ["name", "slug", "description", "status", "owner_agent_id", "objectives", "metadata"],
    filters: ["slug", "status", "owner_agent_id"],
    defaultOrder: "created_at",
  },
  tasks: {
    table: "tasks",
    mutable: true,
    createFields: ["title", "description", "project_id", "owner_agent_id", "status", "priority", "due_at", "definition_of_done", "dependencies", "tags", "metadata"],
    updateFields: ["title", "description", "project_id", "owner_agent_id", "status", "priority", "due_at", "definition_of_done", "dependencies", "tags", "metadata", "completed_at"],
    filters: ["project_id", "owner_agent_id", "status", "priority"],
    defaultOrder: "created_at",
  },
  "work-logs": {
    table: "work_logs",
    mutable: true,
    createFields: ["task_id", "agent_id", "entry_type", "title", "body", "artifacts", "metadata"],
    updateFields: ["task_id", "agent_id", "entry_type", "title", "body", "artifacts", "metadata"],
    filters: ["task_id", "agent_id", "entry_type"],
    defaultOrder: "created_at",
  },
  "daily-updates": {
    table: "daily_updates",
    mutable: true,
    createFields: ["agent_id", "update_date", "summary", "completed", "blockers", "next_steps", "asks", "health"],
    updateFields: ["agent_id", "update_date", "summary", "completed", "blockers", "next_steps", "asks", "health"],
    filters: ["agent_id", "update_date", "health"],
    defaultOrder: "update_date",
  },
  approvals: {
    table: "approvals",
    mutable: true,
    createFields: ["task_id", "project_id", "requested_by_agent_id", "reviewer_agent_id", "title", "summary", "evidence", "risk", "recommendation", "status", "decision_note", "due_at"],
    updateFields: ["task_id", "project_id", "requested_by_agent_id", "reviewer_agent_id", "title", "summary", "evidence", "risk", "recommendation", "status", "decision_note", "due_at", "decided_at", "decided_by"],
    filters: ["task_id", "project_id", "requested_by_agent_id", "reviewer_agent_id", "status"],
    defaultOrder: "created_at",
  },
  activity: {
    table: "activity_log",
    mutable: false,
    createFields: [],
    updateFields: [],
    filters: ["actor_user_id", "action", "entity_type", "entity_id"],
    defaultOrder: "created_at",
  },
};

export function getResource(name: string) {
  return resources[name as ResourceName];
}

export function pickFields(
  body: Record<string, unknown>,
  allowed: string[],
) {
  return Object.fromEntries(
    Object.entries(body).filter(([key, value]) =>
      allowed.includes(key) && value !== undefined
    ),
  );
}
