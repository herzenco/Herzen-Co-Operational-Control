import { isApiError, requireMember } from "../../../../utils/api/auth";
import { fail, ok, preflight } from "../../../../utils/api/responses";

export async function GET(request: Request) {
  const context = await requireMember(request);
  if (isApiError(context)) return context;

  const [agents, projects, tasks, updates, approvals, activity] = await Promise.all([
    context.supabase.from("agents").select("*").order("created_at"),
    context.supabase.from("projects").select("*").order("created_at"),
    context.supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    context.supabase.from("daily_updates").select("*").order("update_date", { ascending: false }).limit(25),
    context.supabase.from("approvals").select("*").order("created_at", { ascending: false }),
    context.supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(50),
  ]);

  const error = [agents, projects, tasks, updates, approvals, activity]
    .map((result) => result.error)
    .find(Boolean);
  if (error) return fail(500, "database_error", error.message);

  return ok({
    viewer: context.member,
    agents: agents.data,
    projects: projects.data,
    tasks: tasks.data,
    daily_updates: updates.data,
    approvals: approvals.data,
    recent_activity: activity.data,
    counts: {
      agents: agents.data?.length || 0,
      projects: projects.data?.length || 0,
      tasks: tasks.data?.length || 0,
      open_tasks: tasks.data?.filter((task) => !["done", "cancelled"].includes(task.status)).length || 0,
      pending_approvals: approvals.data?.filter((approval) => approval.status === "pending").length || 0,
    },
  });
}

export const OPTIONS = preflight;
