import { createHash } from "node:crypto";

export type DbRecord = Record<string, unknown>;

export type WebsitePublicationPayload = {
  schema_version: 1;
  content_item_id: string;
  idempotency_key: string;
  approved_content_hash: string;
  title: string;
  body: string;
  content_type: "article" | "newsletter" | "social_post";
  destination: string;
  slug: string;
  canonical_path: string;
  seo: { title: string; description: string; keywords: string[] };
  featured_image: WebsiteMedia | null;
  media: WebsiteMedia[];
  author: string;
  publish_date: string | null;
  tags: string[];
  categories: string[];
  status: "published";
  source: { system: "occ"; approved_at: string; approved_by: string };
};

export type WebsiteMedia = {
  asset_id?: string;
  role?: string;
  url?: string;
  storage_bucket?: string;
  storage_path?: string;
  file_name?: string;
  mime_type?: string;
  alt_text?: string;
};

export type WebsiteSnapshotResult =
  | { ok: true; payload: WebsitePublicationPayload }
  | { ok: false; errors: string[] };

function record(value: unknown): DbRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as DbRecord : {};
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))];
}

function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as DbRecord).sort().map((key) => [key, stableValue((value as DbRecord)[key])]));
}

export function approvedContentHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function mediaFromAssets(assets: DbRecord[], metadata: DbRecord, item: DbRecord): WebsiteMedia[] {
  const assetMedia: WebsiteMedia[] = assets.map((asset) => {
    const assetMetadata = record(asset.metadata);
    return {
      asset_id: requiredString(asset.id) || undefined,
      role: requiredString(asset.asset_role) || undefined,
      url: requiredString(asset.external_url) || undefined,
      storage_bucket: requiredString(asset.storage_bucket) || undefined,
      storage_path: requiredString(asset.storage_path) || undefined,
      file_name: requiredString(asset.file_name) || undefined,
      mime_type: requiredString(asset.mime_type) || undefined,
      alt_text: requiredString(assetMetadata.alt_text) || undefined,
    } satisfies WebsiteMedia;
  });
  const configuredMedia: WebsiteMedia[] = Array.isArray(metadata.media) ? metadata.media.map((entry) => record(entry)).map((entry) => ({
    url: requiredString(entry.url) || undefined,
    file_name: requiredString(entry.file_name) || undefined,
    mime_type: requiredString(entry.mime_type) || undefined,
    alt_text: requiredString(entry.alt_text) || undefined,
    role: requiredString(entry.role) || undefined,
  })) : [];
  const creativePath = requiredString(item.creative_asset_path);
  if (creativePath) configuredMedia.push({ url: creativePath, role: "featured", file_name: creativePath.split("/").at(-1) });
  return [...assetMedia, ...configuredMedia].filter((asset) => asset.url || asset.storage_path);
}

export function buildWebsitePublicationSnapshot(input: {
  item: DbRecord;
  channel: DbRecord;
  contentType?: DbRecord | null;
  assets?: DbRecord[];
  reviewer: string;
  approvedAt: string;
}): WebsiteSnapshotResult {
  const item = input.item;
  const channel = input.channel;
  const metadata = record(item.metadata);
  const channelConfiguration = record(channel.configuration);
  const deliveryAsset = (input.assets || []).find((asset) => requiredString(asset.id) === requiredString(item.delivery_asset_id));
  const canonicalSnapshot = record(record(deliveryAsset?.metadata).canonical_snapshot);
  const final = { ...item, ...canonicalSnapshot };
  const contentRole = requiredString(metadata.content_role) || requiredString(input.contentType?.slug);
  const contentTypeKey = requiredString(input.contentType?.slug) || contentRole;
  const destinationDefaults = record(channelConfiguration.default_destination_by_content_type);
  const destination = requiredString(metadata.website_destination)
    || requiredString(metadata.destination)
    || requiredString(metadata.placement)
    || requiredString(destinationDefaults[contentTypeKey]);
  const supportedDestinations = strings(channelConfiguration.supported_destinations);
  const typeByDestination = record(channelConfiguration.content_type_by_destination);
  const contentType = requiredString(typeByDestination[destination]) as WebsitePublicationPayload["content_type"];
  const templates = record(channelConfiguration.canonical_path_templates);
  const title = requiredString(final.title);
  const body = requiredString(final.body);
  const slug = requiredString(final.slug);
  const canonicalPath = requiredString(metadata.canonical_path)
    || requiredString(final.canonical_path)
    || requiredString(templates[destination]).replaceAll("{slug}", slug);
  const qa = record(item.qa_checklist);
  const errors: string[] = [];

  if (requiredString(channel.platform) !== "website") errors.push("The assigned channel is not a website publishing channel.");
  if (!destination) errors.push("Select a website destination before approving this blog.");
  else if (!supportedDestinations.includes(destination)) errors.push(`The website destination '${destination}' is not supported by the assigned channel.`);
  if (!(["article", "newsletter", "social_post"] as string[]).includes(contentType)) errors.push("Map the selected website destination to a supported content type.");
  if (!title) errors.push("The approved title is missing.");
  if (!body) errors.push("The approved body is missing.");
  if (!slug) errors.push("The approved slug is missing.");
  if (!canonicalPath || !canonicalPath.startsWith("/") || canonicalPath.includes("?") || canonicalPath.includes("#")) errors.push("Select a valid canonical website path.");
  if (!requiredString(item.publish_at)) errors.push("Select a publish date before approving this blog.");
  if (requiredString(item.audit_status) !== "passed" || Number(item.seo_score || 0) < 80 || Number(item.aeo_score || 0) < 80) errors.push("SEO and AEO audits must both pass at 80 or higher before approval.");
  if (!Object.keys(qa).length || !Object.values(qa).every(Boolean)) errors.push("The OCC QA checklist must pass before approval.");
  if (errors.length) return { ok: false, errors };

  const media = mediaFromAssets(input.assets || [], metadata, item);
  const configuredFeatured = record(metadata.featured_image);
  const featuredImage = Object.keys(configuredFeatured).length
    ? {
        url: requiredString(configuredFeatured.url) || undefined,
        storage_bucket: requiredString(configuredFeatured.storage_bucket) || undefined,
        storage_path: requiredString(configuredFeatured.storage_path) || undefined,
        file_name: requiredString(configuredFeatured.file_name) || undefined,
        mime_type: requiredString(configuredFeatured.mime_type) || undefined,
        alt_text: requiredString(configuredFeatured.alt_text) || undefined,
        role: "featured",
      }
    : media.find((asset) => asset.role === "featured" || requiredString(asset.mime_type).startsWith("image/")) || null;
  const seoKeywords = strings(metadata.seo_keywords).length ? strings(metadata.seo_keywords) : strings(item.tags);
  const content = {
    title,
    body,
    content_type: contentType,
    destination,
    slug,
    canonical_path: canonicalPath,
    seo: {
      title: requiredString(final.seo_title) || title,
      description: requiredString(final.meta_description),
      keywords: seoKeywords,
    },
    featured_image: featuredImage,
    media,
    author: requiredString(metadata.author) || "Herzen Co.",
    publish_date: requiredString(item.publish_at) || null,
    tags: strings(item.tags),
    categories: strings(metadata.categories),
    status: "published" as const,
  };
  const hash = approvedContentHash(content);
  return {
    ok: true,
    payload: {
      schema_version: 1,
      content_item_id: requiredString(item.id),
      idempotency_key: `occ:${requiredString(item.id)}:${hash}`,
      approved_content_hash: hash,
      ...content,
      source: { system: "occ", approved_at: input.approvedAt, approved_by: input.reviewer },
    },
  };
}
