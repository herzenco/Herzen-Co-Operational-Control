import { NextResponse } from "next/server";
import { authorizeCron, createAutomationClient } from "../../../../utils/content-automation/server";
import { runDueSchedules } from "../../../../utils/content-automation/runner";
import { runHerzencoPublishingCycle } from "../../../../utils/content-publishing/lifecycle";

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createAutomationClient();
  const now = new Date();
  const automation = await runDueSchedules(supabase, now, crypto.randomUUID());
  const website_publishing = await runHerzencoPublishingCycle(supabase, now);
  return NextResponse.json({ data: { automation, website_publishing } });
}
