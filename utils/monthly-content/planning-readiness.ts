import type { SupabaseClient } from "@supabase/supabase-js";

type PlanningItem = {
  owner_agent_id?: string | null;
  publish_at?: string | null;
};

type Owner = {
  id?: string | null;
  status?: string | null;
} | null;

export const PLANNING_READINESS_ERROR = "monthly_content_planning_incomplete";

export function missingPlanningFields(item: PlanningItem, owner: Owner) {
  const missing: string[] = [];
  if (!item.owner_agent_id || owner?.id !== item.owner_agent_id || owner.status !== "active") missing.push("owner_agent_id");
  if (!item.publish_at) missing.push("publish_at");
  return missing;
}

export class MonthlyContentPlanningReadinessError extends Error {
  readonly code = PLANNING_READINESS_ERROR;

  constructor(readonly missingFields: string[]) {
    super(`Monthly Content Operations planning is incomplete: ${missingFields.join(", ")}.`);
    this.name = "MonthlyContentPlanningReadinessError";
  }
}

export async function requireMonthlyContentPlanningReady(supabase: SupabaseClient, item: PlanningItem) {
  let owner: Owner = null;
  if (item.owner_agent_id) {
    const { data, error } = await supabase.from("agents")
      .select("id,status")
      .eq("id", item.owner_agent_id)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    owner = data;
  }
  const missingFields = missingPlanningFields(item, owner);
  if (missingFields.length) throw new MonthlyContentPlanningReadinessError(missingFields);
}
