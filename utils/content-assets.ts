export const CONTENT_CREATIVE_BUCKET = "content-creative-assets";

export type ContentCreativeAttachment = {
  bucket: typeof CONTENT_CREATIVE_BUCKET;
  path: string;
  attached: true;
};

type ContentRecord = Record<string, unknown>;

function contentMetadata(record: ContentRecord): Record<string, unknown> {
  return record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
    ? record.metadata as Record<string, unknown>
    : {};
}

export function isLocalContentAsset(value: unknown): boolean {
  return typeof value === "string" && /^(?:\.\.\/|\.\/|\/)?Assets\//i.test(value.trim());
}

export function contentCreativePath(record: ContentRecord): string {
  const attachment = record.creative_attachment;
  if (attachment && typeof attachment === "object" && "path" in attachment) {
    const path = (attachment as { path?: unknown }).path;
    if (typeof path === "string" && path.trim()) return path;
  }
  const canonical = typeof record.creative_asset_path === "string" ? record.creative_asset_path.trim() : "";
  if (canonical) return canonical;
  const imageUrl = contentMetadata(record).image_url;
  if (typeof imageUrl !== "string") return "";
  const storagePrefix = `storage://${CONTENT_CREATIVE_BUCKET}/`;
  return imageUrl.startsWith(storagePrefix) ? imageUrl.slice(storagePrefix.length) : "";
}

export function contentCreativeExternalUrl(record: ContentRecord): string {
  const imageUrl = contentMetadata(record).image_url;
  return typeof imageUrl === "string" && /^https?:\/\//i.test(imageUrl.trim()) ? imageUrl.trim() : "";
}

export function contentCreativeDownloadName(record: ContentRecord): string {
  const storedPath = contentCreativePath(record);
  const externalUrl = contentCreativeExternalUrl(record);
  let sourceName = storedPath.split("/").at(-1) || "";
  if (!sourceName && externalUrl) {
    try {
      sourceName = new URL(externalUrl).pathname.split("/").at(-1) || "";
    } catch {
      sourceName = "";
    }
  }
  const decodedName = (() => {
    try {
      return decodeURIComponent(sourceName);
    } catch {
      return sourceName;
    }
  })();
  const safeSourceName = decodedName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  if (safeSourceName && /\.[a-z0-9]{2,5}$/i.test(safeSourceName)) return safeSourceName;
  const safeTitle = typeof record.title === "string"
    ? record.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    : "";
  return `${safeTitle || "occ-post-image"}.jpg`;
}

export function contentCreativeAttachment(record: ContentRecord): ContentCreativeAttachment | null {
  const path = contentCreativePath(record);
  return path ? { bucket: CONTENT_CREATIVE_BUCKET, path, attached: true } : null;
}

export function serializeContentRecord(record: ContentRecord): ContentRecord {
  return {
    ...record,
    creative_attachment: contentCreativeAttachment(record),
    creative_external_url: contentCreativeExternalUrl(record) || null,
    creative_resolution: isLocalContentAsset(contentMetadata(record).image_url) ? "unresolved_local_asset" : "ready",
  };
}

export function serializeApiResource(resourceName: string, value: unknown): unknown {
  if (resourceName !== "content-items") return value;
  if (Array.isArray(value)) return value.map((record) => serializeContentRecord(record as ContentRecord));
  if (value && typeof value === "object") return serializeContentRecord(value as ContentRecord);
  return value;
}
