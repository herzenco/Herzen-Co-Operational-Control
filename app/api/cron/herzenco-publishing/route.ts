import { NextResponse } from "next/server";
import { authorizeCron, createAutomationClient } from "../../../../utils/content-automation/server";
import { runHerzencoPublishingCycle } from "../../../../utils/content-publishing/lifecycle";

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized." } }, { status: 401 });
  return NextResponse.json({ data: await runHerzencoPublishingCycle(createAutomationClient()) });
}
