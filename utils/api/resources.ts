export type ResourceName =
  | "agents"
  | "operations-profiles"
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
  | "content-assets"
  | "agent-work-items"
  | "agent-work-dependencies"
  | "content-feedback"
  | "social-operations-queue"
  | "content-research-records"
  | "monthly-content-folders"
  | "posting-instruction-templates"
  | "asset-remap-audit"
  | "bubbles-daily-operating-queue"
  | "approval-delivery-packets"
  | "content-generation-runs"
  | "content-pairs"
  | "content-audits"
  | "content-rewrite-iterations"
  | "content-review-events"
  | "automation-schedules"
  | "workflow-runs"
  | "workflow-run-logs"
  | "content-delivery-jobs"
  | "content-publish-jobs"
  | "leads"
  | "workflows"
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
  "operations-profiles": {
    table: "operations_profiles",
    mutable: false,
    createFields: [],
    updateFields: [],
    filters: ["user_id", "active"],
    defaultOrder: "display_name",
  },
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
    createFields: ["title", "description", "project_id", "owner_agent_id", "assigned_user_id", "status", "priority", "due_at", "definition_of_done", "dependencies", "tags", "metadata"],
    updateFields: ["title", "description", "project_id", "owner_agent_id", "assigned_user_id", "status", "priority", "due_at", "definition_of_done", "dependencies", "tags", "metadata", "completed_at"],
    filters: ["project_id", "owner_agent_id", "assigned_user_id", "status", "priority"],
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
      "title", "brief", "body", "caption", "creative_asset_path", "property_id", "channel_id", "content_type_id",
      "owner_agent_id", "research_owner_agent_id", "task_id", "approval_id",
      "distribution_mode", "status", "approval_required",
      "publish_at", "published_at", "final_url", "screenshot_path", "external_job_id",
      "external_status", "failure_message", "research_brief", "metadata",
      "legacy_content_item_id", "legacy_review_url", "source_system",
      "hashtags", "posting_instructions", "tags", "cta", "approval_state", "feedback_version", "package_manifest", "publication_state",
      "source_asset_id", "delivery_asset_id", "linked_research_work_item_id", "linked_creative_work_item_id",
      "linked_paid_media_work_item_id", "delivered_at", "delivered_by_agent_id",
      "research_record_id", "qa_checklist", "qa_passed_at", "approval_packet", "approval_packet_state", "approval_packet_sent_at",
      "paired_content_item_id", "generation_run_id", "target_audience", "conversion_goal", "slug", "seo_title", "meta_description", "reasoning_summary", "source_links", "audit_status", "audit_iteration_count", "seo_score", "aeo_score", "audit_summary", "audit_blockers", "review_ready_at", "review_url", "review_approved_at", "review_approved_by",
    ],
    updateFields: [
      "title", "brief", "body", "caption", "creative_asset_path", "property_id", "channel_id", "content_type_id",
      "owner_agent_id", "research_owner_agent_id", "task_id", "approval_id",
      "distribution_mode", "status", "approval_required",
      "publish_at", "published_at", "final_url", "screenshot_path", "external_job_id",
      "external_status", "failure_message", "research_brief", "metadata",
      "legacy_content_item_id", "legacy_review_url", "source_system",
      "hashtags", "posting_instructions", "tags", "cta", "approval_state", "feedback_version", "package_manifest", "publication_state",
      "source_asset_id", "delivery_asset_id", "linked_research_work_item_id", "linked_creative_work_item_id",
      "linked_paid_media_work_item_id", "delivered_at", "delivered_by_agent_id",
      "research_record_id", "qa_checklist", "qa_passed_at", "approval_packet", "approval_packet_state", "approval_packet_sent_at",
      "paired_content_item_id", "generation_run_id", "target_audience", "conversion_goal", "slug", "seo_title", "meta_description", "reasoning_summary", "source_links", "audit_status", "audit_iteration_count", "seo_score", "aeo_score", "audit_summary", "audit_blockers", "review_ready_at", "review_url", "review_approved_at", "review_approved_by",
    ],
    filters: [
      "property_id", "channel_id", "content_type_id", "owner_agent_id",
      "distribution_mode", "status", "legacy_content_item_id", "source_system",
      "approval_state", "publication_state", "delivered_by_agent_id",
    ],
    defaultOrder: "created_at",
  },
  "content-assets": {
    table: "content_assets", mutable: true,
    createFields: ["content_item_id", "asset_role", "storage_bucket", "storage_path", "external_url", "file_name", "mime_type", "byte_size", "checksum_sha256", "version", "is_current", "metadata", "attached_by_agent_id", "monthly_folder_id", "assigned_publish_date", "removable_after_copy"],
    updateFields: ["asset_role", "storage_bucket", "storage_path", "external_url", "file_name", "mime_type", "byte_size", "checksum_sha256", "version", "is_current", "metadata", "attached_by_agent_id", "monthly_folder_id", "assigned_publish_date", "removable_after_copy"],
    filters: ["content_item_id", "asset_role", "is_current", "attached_by_agent_id", "monthly_folder_id", "assigned_publish_date", "removable_after_copy"], defaultOrder: "created_at",
  },
  "agent-work-items": {
    table: "agent_work_items", mutable: true,
    createFields: ["agent_id", "work_item_type", "title", "body", "summary", "attachments", "status", "content_item_id", "campaign_id", "project_id", "lane", "notes", "request_id", "idempotency_key"],
    updateFields: ["agent_id", "work_item_type", "title", "body", "summary", "attachments", "status", "content_item_id", "campaign_id", "project_id", "lane", "notes"],
    filters: ["agent_id", "work_item_type", "status", "content_item_id", "campaign_id", "project_id", "lane", "request_id", "idempotency_key"], defaultOrder: "updated_at",
  },
  "agent-work-dependencies": {
    table: "agent_work_dependencies", mutable: true,
    createFields: ["upstream_work_item_id", "downstream_work_item_id", "required", "notes"],
    updateFields: ["required", "notes"], filters: ["upstream_work_item_id", "downstream_work_item_id", "required"], defaultOrder: "created_at",
  },
  "content-feedback": {
    table: "content_feedback", mutable: true,
    createFields: ["content_item_id", "campaign_id", "work_item_id", "body", "required", "status", "version", "provided_by", "applied_by_agent_id", "applied_at", "resolution_note", "supersedes_feedback_id"],
    updateFields: ["body", "required", "status", "version", "provided_by", "applied_by_agent_id", "applied_at", "resolution_note", "supersedes_feedback_id"],
    filters: ["content_item_id", "campaign_id", "work_item_id", "required", "status", "provided_by"], defaultOrder: "created_at",
  },
  "social-operations-queue": {
    table: "social_operations_queue", mutable: false, createFields: [], updateFields: [],
    filters: ["property_id", "platform", "owner_agent_id", "status", "approval_state", "publication_state", "has_unresolved_feedback", "ready_to_deliver"], defaultOrder: "publish_at",
  },
  "content-research-records": {
    table: "content_research_records", mutable: true,
    createFields: ["content_item_id", "researcher_agent_id", "what_is_happening", "why_it_fits_account", "how_and_why_it_fits_feed", "current_trend_or_context", "caption_angle", "suggested_posting_time", "status", "finalized_at"],
    updateFields: ["what_is_happening", "why_it_fits_account", "how_and_why_it_fits_feed", "current_trend_or_context", "caption_angle", "suggested_posting_time", "status", "finalized_at"],
    filters: ["content_item_id", "researcher_agent_id", "status"], defaultOrder: "updated_at",
  },
  "monthly-content-folders": {
    table: "monthly_content_folders", mutable: true,
    createFields: ["property_id", "channel_id", "month_start", "storage_bucket", "storage_prefix", "created_by_agent_id"],
    updateFields: ["storage_bucket", "storage_prefix", "created_by_agent_id"],
    filters: ["property_id", "channel_id", "month_start", "created_by_agent_id"], defaultOrder: "month_start",
  },
  "posting-instruction-templates": {
    table: "posting_instruction_templates", mutable: true,
    createFields: ["property_id", "name", "platform", "instructions", "max_hashtags", "active"],
    updateFields: ["name", "platform", "instructions", "max_hashtags", "active"],
    filters: ["property_id", "platform", "active"], defaultOrder: "name",
  },
  "asset-remap-audit": {
    table: "asset_remap_audit", mutable: false, createFields: [], updateFields: [],
    filters: ["content_item_id", "publish_date", "new_source_asset_id"], defaultOrder: "remapped_at",
  },
  "bubbles-daily-operating-queue": {
    table: "bubbles_daily_operating_queue", mutable: false, createFields: [], updateFields: [],
    filters: ["status", "approval_state", "approval_packet_state", "qa_passes", "ready"], defaultOrder: "publish_at",
  },
  "approval-delivery-packets": {
    table: "approval_delivery_packets", mutable: true,
    createFields: ["content_item_id", "approval_id", "channel", "scheduled_for", "payload", "status"],
    updateFields: ["scheduled_for", "payload", "status", "sent_at", "provider_message_id", "failure_message"],
    filters: ["content_item_id", "approval_id", "channel", "status"], defaultOrder: "scheduled_for",
  },
  "content-generation-runs": { table: "content_generation_runs", mutable: false, createFields: [], updateFields: [], filters: ["property_id", "month_start", "status", "request_id", "idempotency_key", "run_kind"], defaultOrder: "created_at" },
  "content-pairs": { table: "content_pairs", mutable: false, createFields: [], updateFields: [], filters: ["generation_run_id", "blog_content_item_id", "linkedin_content_item_id"], defaultOrder: "created_at" },
  "content-audits": { table: "content_audits", mutable: false, createFields: [], updateFields: [], filters: ["content_item_id", "provider", "passed"], defaultOrder: "created_at" },
  "content-rewrite-iterations": { table: "content_rewrite_iterations", mutable: false, createFields: [], updateFields: [], filters: ["content_item_id", "iteration"], defaultOrder: "created_at" },
  "content-review-events": { table: "content_review_events", mutable: true, createFields: ["content_item_id", "event_type", "comment", "reviewer_name", "reviewer_email"], updateFields: ["event_type", "comment", "triaged_by_agent_id"], filters: ["content_item_id", "event_type", "triaged_by_agent_id"], defaultOrder: "created_at" },
  "automation-schedules": { table: "automation_schedules", mutable: true, createFields: ["job_type", "timezone", "schedule_expression", "next_run_at", "enabled", "configuration"], updateFields: ["timezone", "schedule_expression", "next_run_at", "enabled", "configuration"], filters: ["job_type", "enabled"], defaultOrder: "next_run_at" },
  "workflow-runs": { table: "workflow_runs", mutable: false, createFields: [], updateFields: [], filters: ["schedule_id", "generation_run_id", "job_type", "status"], defaultOrder: "created_at" },
  "workflow-run-logs": { table: "workflow_run_logs", mutable: false, createFields: [], updateFields: [], filters: ["run_id", "level", "event"], defaultOrder: "created_at" },
  "content-delivery-jobs": { table: "content_delivery_jobs", mutable: false, createFields: [], updateFields: [], filters: ["delivery_type", "status"], defaultOrder: "scheduled_for" },
  "content-publish-jobs": { table: "content_publish_jobs", mutable: false, createFields: [], updateFields: [], filters: ["content_item_id", "platform", "status"], defaultOrder: "scheduled_for" },
  "content-status-history": {
    table: "content_status_history",
    mutable: false,
    createFields: [],
    updateFields: [],
    filters: ["content_item_id", "from_status", "to_status", "changed_by"],
    defaultOrder: "created_at",
  },
  leads: {
    table: "leads",
    mutable: true,
    createFields: ["property_id", "assigned_agent_id", "contact_name", "company", "email", "phone", "source", "subject", "inquiry", "status", "priority", "next_follow_up_at", "notes", "metadata"],
    updateFields: ["property_id", "assigned_agent_id", "contact_name", "company", "email", "phone", "source", "subject", "inquiry", "status", "priority", "next_follow_up_at", "notes", "metadata"],
    filters: ["property_id", "assigned_agent_id", "source", "status", "priority"],
    defaultOrder: "created_at",
  },
  workflows: {
    table: "workflows",
    mutable: true,
    createFields: ["id", "name", "description", "version", "status", "definition", "owner_id"],
    updateFields: ["name", "description", "status", "definition", "owner_id"],
    filters: ["status", "owner_id"],
    defaultOrder: "updated_at",
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
