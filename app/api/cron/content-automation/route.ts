import { NextResponse } from "next/server";
import { disabledAutomationResult } from "../../../../utils/content-automation/retirement";
import { authorizeCron } from "../../../../utils/content-automation/server";

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ error: disabledAutomationResult("cron_route") }, { status: 409 });
}
