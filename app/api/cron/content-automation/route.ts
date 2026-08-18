import { NextResponse } from "next/server";
import { authorizeCron, createAutomationClient } from "../../../../utils/content-automation/server";
import { runDueSchedules } from "../../../../utils/content-automation/runner";
import { dispatchHerzencoEvents } from "../../../../utils/content-publishing/dispatcher";

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createAutomationClient();
  const now = new Date();
  const website_events = await dispatchHerzencoEvents(supabase, now);
  const automation = await runDueSchedules(supabase, now, crypto.randomUUID());
  return NextResponse.json({ data: { website_events, automation } });
}
