import { NextResponse } from "next/server";
import { isApiError, requireMember } from "../../../../../utils/api/auth";
import { automationErrorMessage, executeAutomationJob } from "../../../../../utils/content-automation/runner";
import { createAutomationClient } from "../../../../../utils/content-automation/server";
import type { AutomationJobType } from "../../../../../utils/content-automation/types";

const jobTypes = new Set<AutomationJobType>(["monthly_generation","weekly_review_pack","publish_day_notice","weekly_k2_refresh","audit_retry"]);

export async function POST(request: Request) {
  const context = await requireMember(request, { write: true });
  if (isApiError(context)) return context;
  const body = await request.json().catch(() => ({})) as { job_type?: AutomationJobType; configuration?: Record<string, unknown> };
  if (!body.job_type || !jobTypes.has(body.job_type)) return NextResponse.json({ error: { message: "A valid job_type is required." } }, { status: 400 });
  try {
    const result = await executeAutomationJob(createAutomationClient(), body.job_type, { configuration: body.configuration || {} });
    return NextResponse.json({ data: result }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: { message: automationErrorMessage(error) } }, { status: 500 });
  }
}
