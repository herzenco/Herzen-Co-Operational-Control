import { isApiError, requireMember } from "../../../utils/api/auth";
import { ok, preflight } from "../../../utils/api/responses";

export async function GET(request: Request) {
  const context = await requireMember(request);
  if (isApiError(context)) return context;

  return ok({
    name: "Herzen Co. Operations API",
    version: "v1",
    actor: context.member,
    endpoints: {
      overview: "/api/v1/overview",
      agents: "/api/v1/agents",
      projects: "/api/v1/projects",
      tasks: "/api/v1/tasks",
      work_logs: "/api/v1/work-logs",
      daily_updates: "/api/v1/daily-updates",
      approvals: "/api/v1/approvals",
      content_properties: "/api/v1/content-properties",
      content_channels: "/api/v1/content-channels",
      content_types: "/api/v1/content-types",
      content_items: "/api/v1/content-items",
      content_status_history: "/api/v1/content-status-history",
      workflows: "/api/v1/workflows",
      workflow_versions: "/api/v1/workflows/{id}/versions",
      restore_workflow_version: "/api/v1/workflows/{id}/versions/{version}/restore",
      activity: "/api/v1/activity",
      token: "/api/v1/auth/token",
      refresh: "/api/v1/auth/refresh",
    },
  });
}

export const OPTIONS = preflight;
