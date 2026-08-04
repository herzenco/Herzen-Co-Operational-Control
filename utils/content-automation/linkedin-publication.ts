import { approvedContentHash } from "./website-publication";

export type DbRecord = Record<string, unknown>;

export type LinkedInMedia = {
  asset_id?: string;
  role?: string;
  url?: string;
  storage_bucket?: string;
  storage_path?: string;
  file_name?: string;
  mime_type?: string;
  alt_text?: string;
};

export type LinkedInPublicationPayload = {
  schema_version: 1;
  content_id: string;
  idempotency_key: string;
  approved_content_hash: string;
  internal_label: string;
  body: string;
  media: LinkedInMedia[];
  property: { id: string; name: string; slug: string };
  approval_status: "approved";
  scheduled_at: string | null;
  platform: "linkedin";
  source: { system: "OCC"; package_manifest_version: number | null };
};

export type LinkedInSnapshotResult =
  | { ok: true; payload: LinkedInPublicationPayload }
  | { ok: false; errors: string[] };

function record(value: unknown): DbRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as DbRecord : {};
}

function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mediaFromAssets(assets: DbRecord[], metadata: DbRecord): LinkedInMedia[] {
  const assetMedia = assets
    .filter((asset) => /^(image|video)\//.test(requiredString(asset.mime_type)))
    .map((asset) => {
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
      } satisfies LinkedInMedia;
    });
  const configuredMedia = Array.isArray(metadata.media)
    ? metadata.media.map(record).map((entry) => ({
        url: requiredString(entry.url) || undefined,
        storage_bucket: requiredString(entry.storage_bucket) || undefined,
        storage_path: requiredString(entry.storage_path) || undefined,
        file_name: requiredString(entry.file_name) || undefined,
        mime_type: requiredString(entry.mime_type) || undefined,
        alt_text: requiredString(entry.alt_text) || undefined,
        role: requiredString(entry.role) || undefined,
      } satisfies LinkedInMedia))
    : [];
  return [...assetMedia, ...configuredMedia].filter((asset) => asset.url || (asset.storage_bucket && asset.storage_path));
}

export function buildLinkedInPublicationSnapshot(input: {
  item: DbRecord;
  property: DbRecord;
  channel: DbRecord;
  assets?: DbRecord[];
  feedback?: DbRecord[];
}): LinkedInSnapshotResult {
  const { item, property, channel } = input;
  const metadata = record(item.metadata);
  const manifest = record(item.package_manifest);
  const deliveryAsset = (input.assets || []).find((asset) => requiredString(asset.id) === requiredString(item.delivery_asset_id));
  const sourceAsset = (input.assets || []).find((asset) => requiredString(asset.id) === requiredString(item.source_asset_id));
  const deliverySnapshot = record(record(deliveryAsset?.metadata).canonical_snapshot);
  const body = requiredString(deliverySnapshot.caption)
    || requiredString(deliverySnapshot.body)
    || requiredString(manifest.caption);
  const errors: string[] = [];

  // Tomorrow's manual publishing scope is the Herzen Co. LinkedIn property. It
  // intentionally does not depend on the Phase 1 generation-run or pilot ID.
  if (requiredString(property.slug) !== "herzen-co") errors.push("The content item is outside the approved Herzen Co. property scope.");
  if (requiredString(property.status) !== "active") errors.push("The content item's property is not active.");
  if (requiredString(channel.platform).toLowerCase() !== "linkedin") errors.push("The assigned channel is not LinkedIn.");
  if (requiredString(channel.property_id) !== requiredString(item.property_id)) errors.push("The LinkedIn channel does not belong to the content item's property.");
  if (requiredString(channel.status) !== "active") errors.push("The assigned LinkedIn channel is not active.");
  if (requiredString(item.approval_state) !== "approved") errors.push("The current OCC package is not approved.");
  if (!requiredString(item.approval_id) || (!requiredString(item.review_approved_at) && !requiredString(item.approved_at))) errors.push("The current package does not have a completed OCC approval record.");
  if (!["approved", "scheduled", "publishing", "published"].includes(requiredString(item.status))) errors.push("The content item is not in an approved publication state.");
  if (requiredString(item.audit_status) !== "passed" || Number(item.seo_score || 0) < 80 || Number(item.aeo_score || 0) < 80) errors.push("SEO and AEO audits must both pass at 80 or higher.");
  if (!sourceAsset || requiredString(sourceAsset.content_item_id) !== requiredString(item.id) || requiredString(sourceAsset.asset_role) !== "source" || sourceAsset.is_current !== true) errors.push("The canonical current source asset is missing or does not match this item.");
  if (!deliveryAsset || requiredString(deliveryAsset.content_item_id) !== requiredString(item.id) || requiredString(deliveryAsset.asset_role) !== "delivery" || deliveryAsset.is_current !== true) errors.push("The canonical current delivery asset is missing or does not match this item.");
  if (!body) errors.push("The approved final LinkedIn copy is missing from the canonical package.");
  if (body.length > 3_000) errors.push("The approved LinkedIn copy exceeds 3,000 characters.");
  if (requiredString(manifest.caption) !== body) errors.push("The final copy does not match the approved OCC package manifest.");
  const qa = record(item.qa_checklist);
  if (!Object.keys(qa).length || !Object.values(qa).every((value) => value === true)) errors.push("The OCC QA checklist has not fully passed.");
  if ((input.feedback || []).some((entry) => entry.required === true && ["received", "blocked"].includes(requiredString(entry.status)))) errors.push("Required OCC feedback is unresolved.");
  if (errors.length) return { ok: false, errors };

  const stableContent = {
    content_id: requiredString(item.id),
    body,
    media: mediaFromAssets(input.assets || [], metadata),
    property_id: requiredString(property.id),
    scheduled_at: requiredString(item.publish_at) || null,
  };
  const hash = approvedContentHash(stableContent);
  return {
    ok: true,
    payload: {
      schema_version: 1,
      content_id: stableContent.content_id,
      idempotency_key: `occ:linkedin:${stableContent.content_id}`,
      approved_content_hash: hash,
      internal_label: requiredString(deliverySnapshot.title) || requiredString(item.title),
      body,
      media: stableContent.media,
      property: {
        id: requiredString(property.id),
        name: requiredString(property.name),
        slug: requiredString(property.slug),
      },
      approval_status: "approved",
      scheduled_at: stableContent.scheduled_at,
      platform: "linkedin",
      source: {
        system: "OCC",
        package_manifest_version: manifest.version !== undefined && Number.isFinite(Number(manifest.version)) ? Number(manifest.version) : null,
      },
    },
  };
}
