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
      activity: "/api/v1/activity",
      token: "/api/v1/auth/token",
      refresh: "/api/v1/auth/refresh",
    },
  });
}

export const OPTIONS = preflight;
