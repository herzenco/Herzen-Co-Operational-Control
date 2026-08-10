import { NextResponse } from "next/server";
import { authorizeCron, createAutomationClient } from "../../../../utils/content-automation/server";
import { runDueSchedules } from "../../../../utils/content-automation/runner";

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ data: await runDueSchedules(createAutomationClient(), new Date(), crypto.randomUUID()) });
}
