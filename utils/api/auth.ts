import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
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

const DEFAULT_OPERATOR_USER_ID = "d550bf69-3af7-40da-a890-ff0138b17e62";

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

function createServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return null;

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function tokensMatch(expected: string | undefined, received: string | undefined) {
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function buildServiceUser(userId: string, email?: string) {
  return {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email,
    created_at: new Date(0).toISOString(),
  } as User;
}

export async function requireMember(
  request: Request,
  options: { write?: boolean; allowAgentWrite?: boolean } = {},
): Promise<ApiContext | NextResponse> {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, accessToken] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !accessToken) {
    return unauthorized("Send a Supabase access token as Authorization: Bearer <token>.");
  }

  if (tokensMatch(process.env.LUPE_API_TOKEN, accessToken)) {
    const supabase = createServiceRoleClient();
    if (!supabase) {
      return unauthorized("The Lupe API token is configured, but the service-role client is not available.");
    }

    const userId = process.env.LUPE_OPERATIONS_USER_ID || DEFAULT_OPERATOR_USER_ID;
    const {
      data: member,
      error: memberError,
    } = await supabase
      .from("operations_members")
      .select("user_id,display_name,role,active,permissions")
      .eq("user_id", userId)
      .eq("active", true)
      .single();

    if (memberError || !member) {
      return unauthorized("The Lupe API token could not be mapped to an active Operations Control member.", 403);
    }

    if (options.write && !["owner", "operator"].includes(member.role)) {
      return unauthorized("This identity does not have write access.", 403);
    }

    return {
      supabase,
      user: buildServiceUser(member.user_id, process.env.LUPE_API_EMAIL),
      member: member as OperationsMember,
    };
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

  if (options.write && !["owner", "operator"].includes(member.role) && !(options.allowAgentWrite && member.role === "agent")) {
    return unauthorized("This identity does not have write access.", 403);
  }

  return { supabase, user, member: member as OperationsMember };
}

export function isApiError(
  context: ApiContext | NextResponse,
): context is NextResponse {
  return context instanceof NextResponse;
}
