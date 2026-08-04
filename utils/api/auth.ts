import { createHash } from "node:crypto";
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
  user: User | null;
  member: OperationsMember;
  agentId: string | null;
  credentialId: string | null;
};

type AgentCredentialRow = {
  id: string;
  agent_id: string;
  scopes: string[] | null;
  active: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  agent: { code: string; name: string; status: string } | null;
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

function createAgentApiClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function hasScope(scopes: string[] | null, scope: string) {
  return Boolean(scopes?.includes(scope) || scopes?.includes("occ:admin"));
}

async function authenticateAgentKey(
  accessToken: string,
  options: { write?: boolean; allowAgentWrite?: boolean },
): Promise<ApiContext | NextResponse> {
  const serviceClient = createAgentApiClient();
  if (!serviceClient) return unauthorized("Agent authentication is not configured on this deployment.", 503);

  const secretHash = createHash("sha256").update(accessToken, "utf8").digest("hex");
  const { data, error } = await serviceClient
    .from("agent_api_credentials")
    .select("id,agent_id,scopes,active,expires_at,revoked_at,agent:agents!inner(code,name,status)")
    .eq("secret_hash", secretHash)
    .maybeSingle();
  const credential = data as unknown as AgentCredentialRow | null;
  const expired = credential?.expires_at ? Date.parse(credential.expires_at) <= Date.now() : false;

  if (error || !credential || !credential.active || credential.revoked_at || expired || credential.agent?.status !== "active") {
    return unauthorized("The agent credential is invalid, expired, or revoked.");
  }
  if (!hasScope(credential.scopes, "occ:read")) return unauthorized("This agent credential cannot read OCC.", 403);
  if (options.write && (!options.allowAgentWrite || !hasScope(credential.scopes, "content:write"))) {
    return unauthorized("This agent credential cannot perform that write.", 403);
  }

  await serviceClient.from("agent_api_credentials").update({ last_used_at: new Date().toISOString() }).eq("id", credential.id);
  return {
    supabase: serviceClient,
    user: null,
    agentId: credential.agent_id,
    credentialId: credential.id,
    member: {
      user_id: credential.agent_id,
      display_name: credential.agent?.name || credential.agent_id,
      role: "agent",
      active: true,
      permissions: { agent_code: credential.agent?.code, scopes: credential.scopes || [] },
    },
  };
}

export async function requireMember(
  request: Request,
  options: { write?: boolean; allowAgentWrite?: boolean } = {},
): Promise<ApiContext | NextResponse> {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, accessToken] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !accessToken) {
    return unauthorized("Send an OCC agent key or Supabase access token as Authorization: Bearer <token>.");
  }

  if (accessToken.startsWith("occ_agent_")) return authenticateAgentKey(accessToken, options);

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

  return { supabase, user, member: member as OperationsMember, agentId: null, credentialId: null };
}

export function isApiError(
  context: ApiContext | NextResponse,
): context is NextResponse {
  return context instanceof NextResponse;
}
