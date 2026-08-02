import { isLocalContentAsset } from "./content-assets";

type ContentWrite = Record<string, unknown>;

function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeContentWrite(value: ContentWrite): { payload: ContentWrite; error?: string } {
  const next = { ...value };
  const meta = metadata(next.metadata);
  const metadataCaption = typeof meta.caption === "string" ? meta.caption.trim() : "";
  const caption = typeof next.caption === "string" ? next.caption.trim() : "";
  const creativePath = typeof next.creative_asset_path === "string" ? next.creative_asset_path.trim() : "";

  if (!caption && metadataCaption) next.caption = metadataCaption;
  if (isLocalContentAsset(meta.image_url) && !creativePath) {
    return {
      payload: next,
      error: "Local Assets/... image paths cannot be rendered by OCC. Upload the image to content-creative-assets and send its creative_asset_path.",
    };
  }
  return { payload: next };
}
