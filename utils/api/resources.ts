export type ResourceName =
  | "agents"
  | "projects"
  | "tasks"
  | "work-logs"
  | "daily-updates"
  | "approvals"
  | "content-properties"
  | "content-channels"
  | "content-types"
  | "content-items"
  | "content-status-history"
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
    createFields: ["task_id", "project_id", "content_item_id", "requested_by_agent_id", "reviewer_agent_id", "title", "summary", "evidence", "risk", "recommendation", "status", "decision_note", "due_at"],
    updateFields: ["task_id", "project_id", "content_item_id", "requested_by_agent_id", "reviewer_agent_id", "title", "summary", "evidence", "risk", "recommendation", "status", "decision_note", "due_at", "decided_at", "decided_by"],
    filters: ["task_id", "project_id", "content_item_id", "requested_by_agent_id", "reviewer_agent_id", "status"],
    defaultOrder: "created_at",
  },
  "content-properties": {
    table: "content_properties",
    mutable: true,
    createFields: ["name", "slug", "status", "notes"],
    updateFields: ["name", "slug", "status", "notes"],
    filters: ["slug", "status"],
    defaultOrder: "name",
  },
  "content-channels": {
    table: "content_channels",
    mutable: true,
    createFields: ["property_id", "platform", "account_name", "account_identifier", "status", "publishing_mode", "configuration"],
    updateFields: ["property_id", "platform", "account_name", "account_identifier", "status", "publishing_mode", "configuration"],
    filters: ["property_id", "platform", "status", "publishing_mode"],
    defaultOrder: "created_at",
  },
  "content-types": {
    table: "content_types",
    mutable: true,
    createFields: ["name", "slug", "description", "status", "recommended_by_agent_id", "properties"],
    updateFields: ["name", "slug", "description", "status", "recommended_by_agent_id", "properties"],
    filters: ["slug", "status", "recommended_by_agent_id"],
    defaultOrder: "name",
  },
  "content-items": {
    table: "content_items",
    mutable: true,
    createFields: [
      "title", "brief", "body", "property_id", "channel_id", "content_type_id",
      "owner_agent_id", "research_owner_agent_id", "task_id", "approval_id",
      "distribution_mode", "status", "approval_required",
      "publish_at", "published_at", "final_url", "screenshot_path", "external_job_id",
      "external_status", "failure_message", "research_brief", "metadata",
    ],
    updateFields: [
      "title", "brief", "body", "property_id", "channel_id", "content_type_id",
      "owner_agent_id", "research_owner_agent_id", "task_id", "approval_id",
      "distribution_mode", "status", "approval_required",
      "publish_at", "published_at", "final_url", "screenshot_path", "external_job_id",
      "external_status", "failure_message", "research_brief", "metadata",
    ],
    filters: ["property_id", "channel_id", "content_type_id", "owner_agent_id", "distribution_mode", "status"],
    defaultOrder: "created_at",
  },
  "content-status-history": {
    table: "content_status_history",
    mutable: false,
    createFields: [],
    updateFields: [],
    filters: ["content_item_id", "from_status", "to_status", "changed_by"],
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
