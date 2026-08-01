export const CONTENT_CREATIVE_BUCKET = "content-creative-assets";

export type ContentCreativeAttachment = {
  bucket: typeof CONTENT_CREATIVE_BUCKET;
  path: string;
  attached: true;
};

type ContentRecord = Record<string, unknown>;

export function contentCreativePath(record: ContentRecord): string {
  const attachment = record.creative_attachment;
  if (attachment && typeof attachment === "object" && "path" in attachment) {
    const path = (attachment as { path?: unknown }).path;
    if (typeof path === "string" && path.trim()) return path;
  }
  return typeof record.creative_asset_path === "string" ? record.creative_asset_path.trim() : "";
}

export function contentCreativeAttachment(record: ContentRecord): ContentCreativeAttachment | null {
  const path = contentCreativePath(record);
  return path ? { bucket: CONTENT_CREATIVE_BUCKET, path, attached: true } : null;
}

export function serializeContentRecord(record: ContentRecord): ContentRecord {
  return { ...record, creative_attachment: contentCreativeAttachment(record) };
}

export function serializeApiResource(resourceName: string, value: unknown): unknown {
  if (resourceName !== "content-items") return value;
  if (Array.isArray(value)) return value.map((record) => serializeContentRecord(record as ContentRecord));
  if (value && typeof value === "object") return serializeContentRecord(value as ContentRecord);
  return value;
}
