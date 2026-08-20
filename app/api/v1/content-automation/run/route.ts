import { NextResponse } from "next/server";
import { isApiError, requireMember } from "../../../../../utils/api/auth";
import { disabledAutomationResult, isLegacyContentAutomationJobType, legacyContentAutomationJobTypes } from "../../../../../utils/content-automation/retirement";
import type { AutomationJobType } from "../../../../../utils/content-automation/types";
import { executeAutomationJob } from "../../../../../utils/content-automation/runner";
import { MonthlyContentPlanningReadinessError } from "../../../../../utils/monthly-content/planning-readiness";

const jobTypes = new Set<AutomationJobType>([...legacyContentAutomationJobTypes, "monthly_content_item", "monthly_content_watchdog"]);

export async function POST(request: Request) {
  const context = await requireMember(request, { write: true, allowAgentWrite: true });
  if (isApiError(context)) return context;
  const body = await request.json().catch(() => ({})) as { job_type?: AutomationJobType; configuration?: Record<string, unknown> };
  if (!body.job_type || !jobTypes.has(body.job_type)) return NextResponse.json({ error: { message: "A valid job_type is required." } }, { status: 400 });
  if (isLegacyContentAutomationJobType(body.job_type)) {
    return NextResponse.json({ error: disabledAutomationResult("manual_route", body.job_type) }, { status: 409 });
  }
  try {
    const result = await executeAutomationJob(context.supabase, body.job_type, { configuration: { ...(body.configuration || {}), publishing_enabled: false }, requestId: crypto.randomUUID(), triggerSource: "manual" });
    return NextResponse.json({ data: result });
  } catch (failure) {
    if (failure instanceof MonthlyContentPlanningReadinessError) {
      return NextResponse.json({ error: { code: failure.code, message: failure.message, missing_fields: failure.missingFields } }, { status: 422 });
    }
    return NextResponse.json({ error: { message: failure instanceof Error ? failure.message : "Monthly content execution failed." } }, { status: 500 });
  }
}
