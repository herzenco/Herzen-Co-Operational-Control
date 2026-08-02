import { isApiError, requireMember } from "../../../../../../../../utils/api/auth";
import { fail, ok, preflight } from "../../../../../../../../utils/api/responses";
import type { WorkflowDocument } from "../../../../../../../../lib/workflows/workflow-schema";

type RouteContext = { params: Promise<{ id: string; version: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { id, version } = await params;
  const context = await requireMember(request, { write: true });
  if (isApiError(context)) return context;
  const numericVersion = Number(version);
  if (!Number.isInteger(numericVersion) || numericVersion < 1) return fail(400, "invalid_version", "Version must be a positive integer.");

  const { data: snapshot, error: snapshotError } = await context.supabase
    .from("workflow_versions")
    .select("definition")
    .eq("workflow_id", id)
    .eq("version", numericVersion)
    .single();
  if (snapshotError || !snapshot) return fail(404, "version_not_found", "That workflow version was not found.");
  const definition = snapshot.definition as WorkflowDocument;
  const { data, error } = await context.supabase
    .from("workflows")
    .update({ name: definition.name, description: definition.description, status: definition.status, definition })
    .eq("id", id)
    .select()
    .single();
  if (error || !data) return fail(400, "restore_failed", error?.message || "The workflow version could not be restored.");
  return ok(data);
}

export const OPTIONS = preflight;
