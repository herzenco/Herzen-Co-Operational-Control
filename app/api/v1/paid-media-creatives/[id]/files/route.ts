import { isApiError, requireMember } from "../../../../../../utils/api/auth";
import { fail, ok, preflight, readJson } from "../../../../../../utils/api/responses";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const context = await requireMember(request, { write: true, allowAgentWrite: true });
  if (isApiError(context)) return context;
  const body = await readJson(request); if (!body) return fail(400, "invalid_json", "Send file metadata.");
  if (!["image/png","image/jpeg","image/webp","image/svg+xml"].includes(String(body.mime_type))) return fail(422, "unsupported_file", "Upload PNG, JPEG, WebP, or SVG files only.");
  if (!body.original_filename || !body.storage_path) return fail(422, "metadata_required", "Original filename and storage path are required.");
  const payload: Record<string, unknown> = {
    creative_id: id,
    original_filename: body.original_filename,
    storage_path: body.storage_path,
    mime_type: body.mime_type,
    byte_size: body.byte_size ?? null,
    ...(context.user ? { uploaded_by: context.user.id } : { uploaded_by_agent_id: context.agentId! }),
  };
  const { data, error } = await context.supabase.from("paid_media_creative_files").insert(payload).select().single();
  if (error || !data) return fail(400, "write_failed", error?.message || "File metadata could not be saved.");
  return ok(data, { status: 201 });
}
export const OPTIONS = preflight;
