import { NextResponse } from "next/server";

export const apiHeaders = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ data }, { ...init, headers: { ...apiHeaders, ...init?.headers } });
}

export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status, headers: apiHeaders },
  );
}

export function preflight() {
  return new NextResponse(null, { status: 204, headers: apiHeaders });
}

export async function readJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
