import { NextResponse } from "next/server";
import { runDueSchedules } from "../../../../utils/content-automation/runner";
import { authorizeCron, createAutomationClient } from "../../../../utils/content-automation/server";

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const results = await runDueSchedules(createAutomationClient());
    return NextResponse.json({ data: { processed: results.length, results } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scheduler failed." }, { status: 500 });
  }
}

