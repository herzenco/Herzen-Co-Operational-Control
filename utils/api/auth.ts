import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { apiHeaders } from "./responses";

export type OperationsMember = {
  user_id: string;
  display_name: string;
  role: "owner" | "operator" | "agent" | "viewer";
  active: boolean;
  permissions: Record<string, unknown>;
};

export type ApiContext = {
  supabase: SupabaseClient;
  user: User;
  member: OperationsMember;
};

function unauthorized(message: string, status = 401) {
  return NextResponse.json(
    { error: { code: status === 401 ? "unauthorized" : "forbidden", message } },
    { status, headers: apiHeaders },
  );
}

export function createApiClient(accessToken?: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : undefined,
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export async function requireMember(
  request: Request,
  options: { write?: boolean } = {},
): Promise<ApiContext | NextResponse> {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, accessToken] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !accessToken) {
    return unauthorized("Send a Supabase access token as Authorization: Bearer <token>.");
  }

  const supabase = createApiClient(accessToken);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    return unauthorized("The access token is missing, expired, or invalid.");
  }

  const { data: member, error: memberError } = await supabase
    .from("operations_members")
    .select("user_id,display_name,role,active,permissions")
    .eq("user_id", user.id)
    .eq("active", true)
    .single();

  if (memberError || !member) {
    return unauthorized("This identity is not an active Operations Control member.", 403);
  }

  if (options.write && !["owner", "operator"].includes(member.role)) {
    return unauthorized("This identity does not have write access.", 403);
  }

  return { supabase, user, member: member as OperationsMember };
}

export function isApiError(
  context: ApiContext | NextResponse,
): context is NextResponse {
  return context instanceof NextResponse;
}
