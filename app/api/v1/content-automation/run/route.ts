import { NextResponse } from "next/server";
import { isApiError, requireMember } from "../../../../../utils/api/auth";
import { disabledAutomationResult, isLegacyContentAutomationJobType, legacyContentAutomationJobTypes } from "../../../../../utils/content-automation/retirement";
import type { AutomationJobType } from "../../../../../utils/content-automation/types";

const jobTypes = new Set<AutomationJobType>(legacyContentAutomationJobTypes);

export async function POST(request: Request) {
  const context = await requireMember(request, { write: true });
  if (isApiError(context)) return context;
  const body = await request.json().catch(() => ({})) as { job_type?: AutomationJobType; configuration?: Record<string, unknown> };
  if (!body.job_type || !jobTypes.has(body.job_type)) return NextResponse.json({ error: { message: "A valid job_type is required." } }, { status: 400 });
  if (isLegacyContentAutomationJobType(body.job_type)) {
    return NextResponse.json({ error: disabledAutomationResult("manual_route", body.job_type) }, { status: 409 });
  }
  return NextResponse.json({ error: { message: "A valid job_type is required." } }, { status: 400 });
}
