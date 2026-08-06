import { NextResponse } from "next/server";
import { runDueSchedules } from "../../../../utils/content-automation/runner";
import { authorizeCron, createAutomationClient } from "../../../../utils/content-automation/server";

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.CONTENT_AUTOMATION_ENABLED !== "true") {
    return NextResponse.json({ data: { status: "paused", reason: "CONTENT_AUTOMATION_ENABLED is not true." } });
  }
  try {
    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    const results = await runDueSchedules(createAutomationClient(), new Date(), requestId);
    return NextResponse.json({ data: { request_id: requestId, processed: results.length, results } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scheduler failed." }, { status: 500 });
  }
}
